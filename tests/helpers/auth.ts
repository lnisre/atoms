import { sendCode, verifyCode } from "../../src/lib/auth/server";
export const fixtureAccount = { id: "synthetic-account", email: "synthetic@example.invalid" };
export const authProfile = { sub: fixtureAccount.id, email: fixtureAccount.email, email_verified: true };
export const authConfig = { CLOUDBASE_ENV_ID: "synthetic-auth", ATOMS_AUTH_SECRET: "a".repeat(64) };
export const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
export function withCookie(request: Request, cookie: string) {
  const headers = new Headers(request.headers); headers.set("cookie", cookie);
  return new Request(request, { headers });
}
// Use real public authentication handlers with a synthetic HTTP provider, never
// a production auth bypass, management identity, or real mailbox.
export async function authenticatedCookie() {
  const oldFetch = globalThis.fetch;
  Object.assign(process.env, authConfig);
  globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/verification")) return Response.json({ verification_id: "synthetic-challenge", is_user: true, expires_in: 600 });
    if (path.endsWith("/verification/verify")) return Response.json({ verification_token: "synthetic-proof" });
    if (path.endsWith("/signin")) return Response.json({ access_token: "synthetic-access", expires_in: 7200 });
    if (path.endsWith("/user/me")) return Response.json(authProfile);
    throw new Error("unexpected fixture request");
  };
  const request = (path: string, body: unknown, cookie = "") => new Request(`http://localhost/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
  try {
    const sent = await sendCode(request("code", { email: fixtureAccount.email }));
    const verified = await verifyCode(request("verify", { code: "123456" }, cookies(sent)));
    if (!verified.ok) throw new Error("synthetic sign-in failed");
    return cookies(verified);
  } finally { globalThis.fetch = oldFetch; }
}
export function modelFetch(mock: typeof fetch) {
  globalThis.fetch = (url, options) => String(url).endsWith("/auth/v1/user/me") ? Promise.resolve(Response.json(authProfile)) : mock(url, options);
}
