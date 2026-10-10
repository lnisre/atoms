// Runtime uses only the verified ordinary user's access token. Management keys
// are never application configuration. Every RPC repeats role/owner validation.
import { AuthError, authFailure, requireIdentity } from "../auth/server";
import { MAX_STATE_BYTES, ProjectError, UUID, validateCloudValue, type CloudProject, type CommitReceipt, type DataSave, type DataSnapshot, type ProjectSummary } from "./contract";

type Identity = Awaited<ReturnType<typeof requireIdentity>>;
const messages: Record<string, [number, string]> = {
  PT401: [401, "登录已失效，请重新登录原账号后重试。"],
  PT404: [404, "找不到该项目，或当前账号没有访问权限。"],
  PT409: [409, "云端已有更新，已拒绝覆盖。当前内容仍保留，可下载副本或重新载入。"],
  PT422: [422, "同一保存操作的内容不一致，请保留页面并下载副本。"],
  PT403: [403, "此代码不能连接正式数据，请先处理项目限制。"],
  PT400: [400, "保存请求格式不正确。"],
};
export async function projectRpc<T>(identity: Identity, name: string, args: object): Promise<T> {
  const env = process.env.CLOUDBASE_ENV_ID;
  if (!env || !/^[a-z\d-]+$/.test(env)) throw new ProjectError("not_configured", "云端存储尚未配置，请联系维护者。");
  let response: Response;
  try {
    response = await fetch(`https://${env}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/atoms_${name}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(18_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${identity.accessToken}` },
      body: JSON.stringify(args),
    });
  } catch { throw new ProjectError("unavailable", "无法确认云端保存结果，请保留页面并重试原保存。"); }
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null || body?.code) {
    const known = messages[body?.code];
    if (known) throw new ProjectError(body.code === "PT409" ? "conflict" : body.code === "PT422" ? "operation_mismatch" : body.code, known[1], known[0]);
    if (response.status === 401) throw new AuthError("unauthenticated", messages.PT401[1]);
    // Do not expose SQL, provider error details, or token-bearing responses.
    throw new ProjectError("unavailable", "云端读写暂时失败，请保留页面后重试。");
  }
  validateCloudValue(name === "list_projects" ? "list" : name === "get_project" ? "project" : name === "get_data" ? "data" : "receipt", body);
  return body as T;
}
export const listCloudProjects = (identity: Identity) => projectRpc<ProjectSummary[]>(identity, "list_projects", {});
export const getCloudProject = (identity: Identity, id: string) => projectRpc<CloudProject>(identity, "get_project", { p_project_id: validId(id) });
export const copyCloudExample = (identity: Identity, operationId: string) => projectRpc<CommitReceipt>(identity, "copy_example", { p_operation_id: validId(operationId) });
export const getCloudData = (identity: Identity, id: string, code: number) => projectRpc<DataSnapshot>(identity, "get_data", { p_project_id: validId(id), p_code_version: validVersion(code) });
export const saveCloudData = (identity: Identity, id: string, save: DataSave) => projectRpc<CommitReceipt>(identity, "save_data", {
  p_project_id: validId(id), p_operation_id: validId(save.operationId),
  p_code_version: validVersion(save.expected?.code), p_data_version: validVersion(save.expected?.data), p_state: validState(save.state),
});
function validId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ProjectError("input", "项目或操作标识不正确。", 400);
  return value;
}
function validVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new ProjectError("input", "缺少有效读取版本，已阻止覆盖保存。", 400);
  return value;
}
function validState(value: unknown) {
  const json = JSON.stringify(value);
  if (json === undefined || Buffer.byteLength(json) > MAX_STATE_BYTES) throw new ProjectError("input", "应用数据仅支持不超过 1 MB 的 JSON 状态。", 413);
  return value;
}
export async function projectInput(request: Request, maxBytes = MAX_STATE_BYTES + 4096) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ProjectError("input", "请求格式不正确。", 415);
  // Bound the stream, including requests with no Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ProjectError("input", "缺少保存内容。", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new ProjectError("input", "保存内容过大。", 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ProjectError("input", "无法读取保存内容。", 400); }
}
export async function projectResponse(request: Request, run: (identity: Identity) => Promise<unknown>) {
  try {
    const identity = await requireIdentity(request);
    const expectedOwner = request.headers.get("X-Atoms-Account");
    if (expectedOwner && expectedOwner !== identity.account.id) throw new ProjectError("account_changed", "当前登录账号与页面内容不一致，请重新登录原账号。", 403);
    return Response.json(await run(identity), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return authFailure(error);
    const safe = error instanceof ProjectError ? error : new ProjectError("unavailable", "云端读写暂时失败，请保留页面后重试。");
    return Response.json({ code: safe.code, error: safe.message }, { status: safe.status, headers: { "Cache-Control": "no-store" } });
  }
}
