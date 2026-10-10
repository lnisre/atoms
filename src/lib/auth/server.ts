import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Account } from "./contract";

const SESSION = "atoms-session";
const CHALLENGE = "atoms-login";
type Session = { accessToken: string; expiresAt: number };
type Challenge = { email: string; verificationId: string; isUser: boolean; expiresAt: number; sentAt: number };
export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 401) { super(message); }
}
export function authFailure(error: unknown) {
  const safe = error instanceof AuthError ? error : new AuthError("unavailable", "登录服务暂时不可用，请稍后重试。", 503);
  return Response.json({ error: safe.message, code: safe.code }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
}
function key() {
  const secret = process.env.ATOMS_AUTH_SECRET;
  if (!secret || !/^[a-f\d]{64}$/i.test(secret)) throw new AuthError("not_configured", "登录服务尚未配置，请联系维护者。", 503);
  return Buffer.from(secret, "hex");
}
function seal(name: string, value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(name));
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function read<T>(request: Request, name: string): T | null {
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value || value.length > 3800) return null;
  try {
    const raw = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(raw.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString());
  } catch (error) { if (error instanceof AuthError) throw error; return null; }
}
function cookie(response: Response, name: string, value: unknown, maxAge: number) {
  const encoded = value === null ? "" : seal(name, value);
  if (encoded.length > 3800) throw new AuthError("unavailable", "登录会话过大，无法安全保存，请联系维护者。", 503);
  response.headers.append("Set-Cookie", `${name}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
export function checkOrigin(request: Request) {
  // Explicit configuration survives Vercel/custom gateway host rewriting. Never
  // trust arbitrary forwarded headers to choose a permitted public origin.
  const expected = process.env.ATOMS_APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get("origin") && request.headers.get("origin") !== expected)
    throw new AuthError("origin", "请从本网站重新发起操作。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("origin", "请从本网站重新发起操作。", 403);
}
async function provider(path: string, body?: unknown, accessToken?: string): Promise<Record<string, unknown>> {
  const env = process.env.CLOUDBASE_ENV_ID;
  if (!env || !/^[a-z\d-]+$/.test(env)) throw new AuthError("not_configured", "登录服务尚未配置，请联系维护者。", 503);
  let response: Response;
  try {
    response = await fetch(`https://${env}.api.tcloudbasegateway.com/auth/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
  } catch { throw new AuthError("unavailable", "无法连接登录服务，请检查网络后重试。", 503); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const code = typeof data.error === "string" ? data.error : "unavailable";
    // Never expose provider descriptions, credentials or raw responses.
    if (code === "invalid_verification_code") throw new AuthError("invalid_code", "验证码错误，请重新输入。", 400);
    if (path.startsWith("/verification") && /expired|verification.*(not_found|invalid)|invalid.*verification/.test(code)) throw new AuthError("expired_code", "验证码已过期或失效，请重新发送。", 400);
    if (code === "captcha_required") throw new AuthError("captcha_required", "邮件服务要求额外验证，暂时无法继续。请稍后重试或联系维护者。", 429);
    if (response.status === 429 || /limit|frequent/.test(code)) throw new AuthError("rate_limited", "请求过于频繁，请稍后重试。", 429);
    if (response.status === 401 || /invalid_token|unauthorized|invalid_grant|token_expired|expired_token/.test(code)) throw new AuthError("unauthenticated", "登录已失效，请重新登录。", 401);
    throw new AuthError("unavailable", path === "/verification" ? "验证码发送失败，请稍后重试；持续失败请联系维护者检查邮件配置。" : "登录服务暂时不可用，请稍后重试。", 503);
  }
  return data;
}
async function verifiedAccount(accessToken: string): Promise<Account> {
  const data = await provider("/user/me", undefined, accessToken);
  if (typeof data.sub !== "string" || !data.sub || data.sub === "service_account" || typeof data.email !== "string" || !data.email || data.email_verified !== true)
    throw new AuthError("unauthenticated", "请使用邮箱验证码登录。", 401);
  return { id: data.sub, email: data.email };
}
export async function requireIdentity(request: Request): Promise<{ account: Account; accessToken: string }> {
  checkOrigin(request);
  const session = read<Session>(request, SESSION);
  if (!session || !session.accessToken || !(session.expiresAt > Date.now())) throw new AuthError("unauthenticated", "请先登录，再继续操作。", 401);
  return { account: await verifiedAccount(session.accessToken), accessToken: session.accessToken };
}
export async function requireAccount(request: Request): Promise<Account> {
  return (await requireIdentity(request)).account;
}
async function input(request: Request) {
  checkOrigin(request);
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AuthError("input", "请求格式不正确。", 415);
  const raw = await request.text();
  if (raw.length > 2048) throw new AuthError("input", "登录输入过长。", 413);
  try { return JSON.parse(raw) ?? {}; } catch { throw new AuthError("input", "无法读取登录信息，请重试。", 400); }
}
export async function sendCode(request: Request) {
  try {
    key();
    const body = await input(request);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("input", "请输入有效的邮箱地址。", 400);
    const previous = read<Challenge>(request, CHALLENGE);
    if (previous && Date.now() - previous.sentAt < 60_000) throw new AuthError("rate_limited", "验证码刚刚发送，请等待 60 秒后重试。", 429);
    const data = await provider("/verification", { email, target: "ANY" });
    if (typeof data.verification_id !== "string" || typeof data.expires_in !== "number" || data.expires_in <= 0) throw new Error("invalid provider response");
    const expiresIn = Math.min(data.expires_in, 600);
    const response = Response.json({ sent: true, expiresIn, retryAfter: 60 }, { headers: { "Cache-Control": "no-store" } });
    cookie(response, CHALLENGE, { email, verificationId: data.verification_id, isUser: data.is_user === true, sentAt: Date.now(), expiresAt: Date.now() + expiresIn * 1000 } satisfies Challenge, expiresIn);
    return response;
  } catch (error) { return authFailure(error); }
}
export async function verifyCode(request: Request) {
  try {
    const body = await input(request), challenge = read<Challenge>(request, CHALLENGE);
    if (!challenge || challenge.expiresAt <= Date.now()) throw new AuthError("expired_code", "验证码已过期，请重新发送。", 400);
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new AuthError("input", "请输入 6 位邮箱验证码。", 400);
    const verification = await provider("/verification/verify", { verification_id: challenge.verificationId, verification_code: body.code });
    if (typeof verification.verification_token !== "string") throw new Error("invalid verification response");
    const tokens = await provider(challenge.isUser ? "/signin" : "/signup", { verification_token: verification.verification_token, ...(!challenge.isUser ? { email: challenge.email } : {}) });
    if (typeof tokens.access_token !== "string" || typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) throw new Error("invalid token response");
    const account = await verifiedAccount(tokens.access_token);
    const expiresIn = Math.min(tokens.expires_in, 86400);
    const response = Response.json({ account }, { headers: { "Cache-Control": "no-store" } });
    cookie(response, SESSION, { accessToken: tokens.access_token, expiresAt: Date.now() + expiresIn * 1000 } satisfies Session, expiresIn);
    cookie(response, CHALLENGE, null, 0);
    return response;
  } catch (error) { return authFailure(error); }
}
export async function getSession(request: Request) {
  try { return Response.json({ account: await requireAccount(request) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authFailure(error); }
}
export async function logout(request: Request) {
  try {
    await input(request);
    const session = read<Session>(request, SESSION);
    if (session) {
      try { await provider("/user/signout", {}, session.accessToken); }
      catch (error) { if (!(error instanceof AuthError && error.status === 401)) throw error; }
    }
    const response = Response.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
    cookie(response, SESSION, null, 0); cookie(response, CHALLENGE, null, 0);
    return response;
  } catch (error) { return authFailure(error); }
}
