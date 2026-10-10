import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as list } from "../src/app/api/projects/route";
import { POST as copy } from "../src/app/api/projects/example/route";
import { GET as read } from "../src/app/api/projects/[id]/route";
import { GET as readData, PUT as save } from "../src/app/api/projects/[id]/data/route";
import { CloudDataSession, unsavedCopy } from "../src/lib/cloud-projects/client";
import { authenticatedCookie, authProfile, authConfig } from "./helpers/auth";
import type { SavedProject } from "../src/lib/project-store";

const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
const id = "bd0f1e78-d1e0-4d72-9665-a5018539ba27", operationId = "778a7aef-93ef-433d-b93c-a208f305aa0d";
const context = { params: Promise.resolve({ id }) };
const version = { code: 1, data: 1 };
const receipt = { projectId: id, version: { code: 1, data: 2 }, updatedAt: "2026-10-10T00:00:00.000Z" };
beforeEach(() => { Object.assign(process.env, authConfig); delete process.env.ATOMS_APP_ORIGIN; });
afterEach(() => {
  globalThis.fetch = oldFetch;
  for (const key of [...Object.keys(authConfig), "ATOMS_APP_ORIGIN"]) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; }
});
function request(method: string, body?: unknown, cookie = "", owner?: string) {
  return new Request(`http://localhost/api/projects/${id}/data?codeVersion=1`, { method, headers: { "Content-Type": "application/json", cookie, ...(owner ? { "X-Atoms-Account": owner } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
test("all project routes reject anonymous and forged identity; opaque iframe requests cannot use cookie authority", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("unexpected provider access"); };
  for (const cookie of ["", "userId=owner", "atoms-session=forged"]) {
    assert.equal((await list(request("GET", undefined, cookie))).status, 401);
    assert.equal((await copy(request("POST", { operationId, ownerId: "forged" }, cookie))).status, 401);
    assert.equal((await read(request("GET", undefined, cookie), context)).status, 401);
    assert.equal((await readData(request("GET", undefined, cookie), context)).status, 401);
    assert.equal((await save(request("PUT", { operationId, expected: version, state: {} }, cookie), context)).status, 401);
  }
  const forgedOrigin = request("PUT", {}); forgedOrigin.headers.set("origin", "null");
  assert.equal((await save(forgedOrigin, context)).status, 403); assert.equal(calls, 0);
});
test("BFF forwards verified ordinary token and fixed project/action inputs only; no management or browser owner", async () => {
  const cookie = await authenticatedCookie(); let rpc = "", body: unknown;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/user/me")) return Response.json(authProfile);
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer synthetic-access");
    rpc = String(url); body = JSON.parse(String(options?.body));
    return Response.json(receipt);
  };
  const response = await copy(request("POST", { operationId, ownerId: "someone-else", document: { html: "forged" } }, cookie));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(rpc, /synthetic-auth.api.tcloudbasegateway.com\/v1\/rdb\/rest\/rpc\/atoms_copy_example$/);
  assert.deepEqual(body, { p_operation_id: operationId }); assert.doesNotMatch(await response.text(), /synthetic-access|ownerId/);
  rpc = "";
  assert.equal((await save(request("PUT", { operationId, expected: version, state: { kept: true } }, cookie, "other-account"), context)).status, 403);
  assert.equal(rpc, "");
});
test("versions and state are required; stale writes remain distinct from lost-response replay; provider errors are sanitized", async () => {
  const cookie = await authenticatedCookie(); let code = "PT409", writes = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/user/me")) return Response.json(authProfile);
    writes++; return code ? Response.json({ code, message: "secret SQL/token detail" }, { status: 400 }) : Response.json(receipt);
  };
  for (const expected of [undefined, { code: 1 }, { code: 1, data: 0 }, { code: "1", data: 1 }]) assert.equal((await save(request("PUT", { operationId, expected, state: {} }, cookie), context)).status, 400);
  assert.equal((await save(request("PUT", { operationId, expected: version }, cookie), context)).status, 413);
  assert.equal(writes, 0);
  const payload = { operationId, expected: version, state: { kept: true } };
  const conflict = await save(request("PUT", payload, cookie), context);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "conflict");
  code = ""; const replay = await save(request("PUT", payload, cookie), context);
  assert.deepEqual(await replay.json(), receipt);
  code = "XX000"; const failure = await save(request("PUT", payload, cookie), context);
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /secret|SQL|token/);
});
test("session read failure cannot become empty state or enable an overwrite", async () => {
  let writes = 0;
  globalThis.fetch = async (_, options) => { if (options?.method === "PUT") writes++; return Response.json({ code: "unavailable", error: "read failure" }, { status: 503 }); };
  const session = new CloudDataSession("owner", id, 1);
  await assert.rejects(session.load(), /read failure/);
  await assert.rejects(session.save({ mustNotWrite: true }), /尚未成功读取/);
  assert.equal(session.status.phase, "failed"); assert.equal(writes, 0); session.dispose();
});
test("failed save preserves exact platform payload, owner and operation for replay, blocking replacement edits", async () => {
  const bodies: string[] = []; let attempts = 0;
  globalThis.fetch = async (_, options) => {
    assert.equal(new Headers(options?.headers).get("X-Atoms-Account"), "owner");
    if (options?.method === "GET") return Response.json({ state: { bill: 20 }, hasData: true, version });
    bodies.push(String(options?.body));
    if (++attempts === 1) throw new Error("committed response lost");
    return Response.json(receipt);
  };
  const session = new CloudDataSession("owner", id, 1); await session.load();
  const state = { bill: 80 }; await assert.rejects(session.save(state)); state.bill = 99;
  assert.equal(session.status.phase, "failed"); assert.deepEqual(session.status.pending?.state, { bill: 80 });
  await assert.rejects(session.save({ bill: 100 }), /原保存尚未确认/);
  await assert.rejects(session.load(), /原保存尚未确认/);
  await session.retry(); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(await session.load(), { state: { bill: 80 } }); assert.equal(session.status.pending, undefined);
  session.dispose();
});
test("saving remains pending until commit acknowledgment and disposal suppresses late state/commit callbacks", async () => {
  let finish!: (response: Response) => void, commits = 0;
  globalThis.fetch = async (_, options) => options?.method === "GET" ? Response.json({ state: null, hasData: false, version }) : new Promise(resolve => { finish = resolve; });
  const session = new CloudDataSession("owner", id, 1, () => commits++); await session.load();
  const saving = session.save({ bill: 90 });
  assert.equal(session.status.phase, "saving"); assert.ok(session.status.pending); assert.equal(commits, 0);
  session.dispose(); finish(Response.json(receipt)); await assert.rejects(saving, /页面已离开/); assert.equal(commits, 0);
  await assert.rejects(session.save({ bill: 99 }), /页面已离开/);
});
test("conflict retry retains original code/data versions and unsaved download contains code/state without account credentials", async () => {
  const bodies: { expected: unknown }[] = [];
  globalThis.fetch = async (_, options) => {
    if (options?.method === "GET") return Response.json({ state: null, hasData: false, version });
    bodies.push(JSON.parse(String(options?.body))); return Response.json({ code: "conflict", error: "云端已有更新" }, { status: 409 });
  };
  const session = new CloudDataSession("owner", id, 1); await session.load();
  await assert.rejects(session.save({ bill: 91 })); await assert.rejects(session.retry());
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[1].expected, version);
  const project: SavedProject = { id, title: "fixture", requirement: "keep requirement", updatedAt: receipt.updatedAt, result: { html: "<!doctype html><html></html>", model: "fixture", durationMs: 0, generatedAt: receipt.updatedAt } };
  const download = unsavedCopy(project, session.status.pending!.state);
  assert.equal(download.savedToCloud, false); assert.equal(download.importSupported, false);
  assert.equal(download.requirement, project.requirement); assert.equal(download.code, project.result.html); assert.deepEqual(download.businessState, { bill: 91 });
  assert.doesNotMatch(JSON.stringify(download), /owner|accessToken|cookie|synthetic-access/); session.dispose();
});

test("malformed success responses cannot authorize empty-state overwrite or acknowledge a save", async () => {
  let malformedRead = true;
  globalThis.fetch = async (_, options) => options?.method === "GET" ? Response.json(malformedRead ? { version } : { version, state: null, hasData: false }) : Response.json({ projectId: id });
  const session = new CloudDataSession("owner", id, 1);
  await assert.rejects(session.load(), /返回内容不完整/);
  await assert.rejects(session.save({ bill: 1 }), /尚未成功读取/);
  malformedRead = false; await session.load();
  await assert.rejects(session.save({ bill: 2 }), /返回内容不完整/);
  assert.equal(session.status.phase, "failed"); assert.deepEqual(session.status.pending?.state, { bill: 2 }); session.dispose();
});
test("oversized JSON remains downloadable in platform memory, without sending an oversized write", async () => {
  let writes = 0;
  globalThis.fetch = async (_, options) => { if (options?.method === "PUT") writes++; return Response.json({ version, state: null, hasData: false }); };
  const session = new CloudDataSession("owner", id, 1); await session.load();
  const state = { text: "x".repeat(1_000_001) };
  await assert.rejects(session.save(state), /超过 1 MB/); assert.deepEqual(session.status.pending?.state, state);
  assert.equal(writes, 0); session.dispose();
});
