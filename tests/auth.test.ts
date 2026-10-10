import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { sendCode, verifyCode, getSession, logout, requireAccount } from "../src/lib/auth/server";
import { PendingLoginAction } from "../src/lib/auth/contract";
import { POST as generate } from "../src/app/api/generate/route";
import { teamEntry, teamControl } from "../src/lib/team/server";
import { authenticatedCookie, authConfig, authProfile, cookies } from "./helpers/auth";
const oldFetch = globalThis.fetch;
const oldEnv = { ...process.env };
beforeEach(() => { Object.assign(process.env, authConfig); delete process.env.ATOMS_APP_ORIGIN; });
afterEach(() => { globalThis.fetch = oldFetch; for (const name of [...Object.keys(authConfig), "ATOMS_APP_ORIGIN", "ATOMS_INTERNAL_KEY", "ATOMS_ARTIFACT_SECRET"]) { if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name]; } });
function request(path: string, body: unknown = {}, cookie = "", origin = "http://localhost") {
  return new Request(`http://localhost/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json", origin, cookie }, body: JSON.stringify(body) });
}

test("all public generation protocols and controls reject absent/forged identities before any provider call", async () => {
  globalThis.fetch = async () => { throw new Error("must not call provider"); };
  for (const cookie of ["", "atoms-session=forged", "userId=another-account"]) {
    for (const protocol of ["", "atoms-team/3", "old"]) {
      const req = request("generate", { requirement: "paid", userId: "owner" }, cookie);
      if (protocol) req.headers.set("x-atoms-protocol", protocol);
      assert.equal((await generate(req)).status, 401);
    }
    assert.equal((await teamEntry(request("generate", {ticket:{payload:"forged",signature:"forged"}}, cookie))).status, 401);
    assert.equal((await teamControl(request("team", { action: "cancel", taskId: "stolen", token: "stolen" }, cookie))).status, 401);
  }
});
test("cross-site and opaque-origin requests cannot send mail or create sessions", async () => {
  globalThis.fetch = async () => { throw new Error("must not contact provider"); };
  for (const origin of ["null", "https://evil.invalid"]) {
    assert.equal((await sendCode(request("auth/code", { email: "a@example.invalid" }, "", origin))).status, 403);
    assert.equal((await verifyCode(request("auth/verify", { code: "123456" }, "", origin))).status, 403);
  }
});
test("public signup and existing login use server-bound challenge; restore verifies current identity, logout revokes", async () => {
  for (const isUser of [false, true]) {
    const paths: string[] = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (path.endsWith("/verification")) { assert.equal(body.target,"ANY"); return Response.json({verification_id:"mail-challenge",expires_in:600,is_user:isUser}); }
      if (path.endsWith("/verification/verify")) { assert.equal(body.verification_id,"mail-challenge"); return Response.json({verification_token:"proof"}); }
      if (path.endsWith("/signin") || path.endsWith("/signup")) { assert.equal(body.verification_token,"proof"); assert.equal(body.email,isUser ? undefined : "synthetic@example.invalid"); return Response.json({access_token:"private-access-token",expires_in:7200,refresh_token:"discarded-refresh"}); }
      if (path.endsWith("/user/me")) { assert.equal(new Headers(init?.headers).get("authorization"),"Bearer private-access-token"); return Response.json(authProfile); }
      if (path.endsWith("/user/signout")) return Response.json({});
      throw new Error("unexpected provider request");
    };
    const sent=await sendCode(request("auth/code", {email:"synthetic@example.invalid"}));
    assert.equal(sent.status,200); assert.doesNotMatch(await sent.clone().text(),/is_user|verification_id/);
    assert.match(sent.headers.get("set-cookie")!,/HttpOnly; SameSite=Lax/);
    const signed=await verifyCode(request("auth/verify", {code:"123456",email:"attacker@example.invalid",isUser:!isUser}, cookies(sent)));
    assert.equal(signed.status,200); assert.ok(paths.includes(isUser ? "/auth/v1/signin" : "/auth/v1/signup"));
    const wire=await signed.clone().text();assert.doesNotMatch(wire,/private-access|refresh|proof/);
    assert.doesNotMatch(cookies(signed),/private-access|refresh|proof/);
    const session=await getSession(request("auth/session",{},cookies(signed)));assert.deepEqual((await session.json()).account,{id:authProfile.sub,email:authProfile.email});
    const out=await logout(request("auth/logout",{},cookies(signed)));assert.equal(out.status,200);assert.match(out.headers.get("set-cookie")!,/Max-Age=0/);assert.ok(paths.includes("/auth/v1/user/signout"));
  }
});
test("wrong/expired codes and send failures give retryable safe feedback; challenge resend cooldown is enforced", async () => {
  globalThis.fetch=async()=>Response.json({verification_id:"challenge",expires_in:600});
  const sent=await sendCode(request("auth/code",{email:"a@example.invalid"})), cookie=cookies(sent);
  assert.equal((await sendCode(request("auth/code",{email:"b@example.invalid"},cookie))).status,429);
  for(const [providerError, code] of [["invalid_verification_code","invalid_code"],["verification_code_expired","expired_code"],["captcha_required","captcha_required"]]) {
    globalThis.fetch=async()=>Response.json({error:providerError,error_description:"SECRET"},{status:400});
    const response=await verifyCode(request("auth/verify",{code:"123456"},cookie));const data=await response.json();assert.equal(data.code,code);assert.doesNotMatch(data.error,/SECRET/);
  }
  globalThis.fetch=async()=>Response.json({error:"smtp_failure",error_description:"SECRET"},{status:500});
  const failed=await sendCode(request("auth/code",{email:"a@example.invalid"}));assert.equal(failed.status,503);assert.match((await failed.json()).error,/发送失败/);
  assert.equal((await verifyCode(request("auth/verify",{code:"123456"}))).status,400);
});
test("provider rejection, unverified email and management identity fail closed; outage is not anonymous success", async () => {
  const cookie=await authenticatedCookie();
  for (const profile of [{...authProfile,email_verified:false},{...authProfile,sub:"service_account"}]) {
    globalThis.fetch=async()=>Response.json(profile);
    assert.equal((await getSession(request("auth/session",{},cookie))).status,401);
  }
  globalThis.fetch=async()=>Response.json({error:"invalid_token"},{status:401});
  assert.equal((await getSession(request("auth/session",{},cookie))).status,401);
  globalThis.fetch=async()=>{throw new Error("outage");};
  assert.equal((await getSession(request("auth/session",{},cookie))).status,503);
});
test("configured public origin survives rewritten internal host and does not trust forwarded host", async () => {
  const cookie=await authenticatedCookie();process.env.ATOMS_APP_ORIGIN="https://atoms.example";
  globalThis.fetch=async()=>Response.json(authProfile);
  const valid=request("generate",{},cookie,"https://atoms.example");assert.equal((await requireAccount(valid)).id,authProfile.sub);
  const forged=request("generate",{},cookie,"https://evil.invalid");forged.headers.set("x-forwarded-host","evil.invalid");
  await assert.rejects(requireAccount(forged),/本网站/);
});
test("ordinary login has no action; an explicit intent is taken once and cancellation clears it", () => {
  const pending=new PendingLoginAction();assert.equal(pending.take(),null);
  const intent={id:"same-action",kind:"generate" as const,requirement:"keep my input"};pending.set(intent);pending.set({...intent,id:"double-click"});
  assert.deepEqual(pending.take(),intent);assert.equal(pending.take(),null);
  pending.set({id:"save",kind:"save-example",templateId:"tip-calculator"});pending.clear();assert.equal(pending.take(),null);
});

test("expired/tampered session cannot start a new operation", async t => {
  const cookie=await authenticatedCookie();let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json(authProfile);};
  const value=cookie.match(/atoms-session=([^;]+)/)![1];
  const tampered='atoms-session='+(value[0]==='A'?'B':'A')+value.slice(1);
  assert.equal((await getSession(request('auth/session',{},tampered))).status,401);
  const now=Date.now();t.mock.method(Date,'now',()=>now+86400_000);
  assert.equal((await getSession(request('auth/session',{},cookie))).status,401);
  assert.equal(calls,0);
});
test("task ticket binds verified owner and can be consumed only once, without resetting original start time", async () => {
  const cookie=await authenticatedCookie();process.env.ATOMS_INTERNAL_KEY='fixture-internal-key';process.env.ATOMS_ARTIFACT_SECRET='b'.repeat(64);
  let profile=authProfile;globalThis.fetch=async url=>String(url).endsWith('/user/me')?Response.json(profile):Response.json({projectId:crypto.randomUUID(),version:{code:1,data:1},updatedAt:new Date().toISOString()});
  const req=request('generate',{projectId:crypto.randomUUID(),requirement:'synthetic no-model task'},cookie);
  req.headers.set('x-atoms-task-id',crypto.randomUUID());
  const negotiated=await teamEntry(req);assert.equal(negotiated.status,200);
  const {ticket}=await negotiated.json();const payload=JSON.parse(ticket.payload);assert.equal(payload.binding.ownerId,authProfile.sub);
  const consume=()=>{const r=request('generate',{ticket},cookie);r.headers.set('x-atoms-internal','fixture-internal-key');return teamEntry(r);};
  profile={...authProfile,sub:'different-account'};assert.equal((await consume()).status,403);
  profile=authProfile;
  const first=await consume();assert.equal(first.status,503); // no Python/model configuration in this test
  assert.equal((await consume()).status,409);
});
