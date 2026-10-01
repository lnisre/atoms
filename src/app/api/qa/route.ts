import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { qualificationFixture, variants, type FixtureName, type Variant } from "@/lib/qa/fixtures";
import { validateResult, type ToolRequest, type ToolResult } from "@/lib/qa/contract";
export const runtime = "nodejs";
const localKey = randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function key() {
  if (process.env.QA_TOOL_SIGNING_KEY) return process.env.QA_TOOL_SIGNING_KEY;
  if (process.env.NODE_ENV !== "production") return localKey;
  throw new Error("QA_TOOL_SIGNING_KEY 未配置；检查工具不可用");
}
function sign(request: ToolRequest) { return createHmac("sha256", key()).update(JSON.stringify(request)).digest("hex"); }
export async function POST(request: Request) {
  try {
    // Qualification surface accepts only server-owned synthetic fixtures. No
    // arbitrary code/data upload, provider credentials, or paid calls here.
    if (Number(request.headers.get("content-length")) > 250_000) return Response.json({ error: "请求过大" }, { status: 413 });
    const raw = await request.text();
    if (raw.length > 250_000) return Response.json({ error: "请求过大" }, { status: 413 });
    const body = JSON.parse(raw);
    if (body.action === "start") {
      if (!/^[a-f0-9-]{36}$/.test(body.taskId) || !["todo", "reading"].includes(body.fixture) || !variants.includes(body.variant)) throw new Error("非法任务或夹具");
      const fixture = qualificationFixture(body.fixture as FixtureName, body.variant as Variant);
      const toolRequest: ToolRequest = { protocol: "atoms-qa/1", taskId: body.taskId, requestId: randomUUID(), html: fixture.html, codeHash: hash(fixture.html), planHash: hash(JSON.stringify(fixture.scenarios)), scenarios: fixture.scenarios, deadline: Date.now() + fixture.timeoutMs };
      return Response.json({ request: toolRequest, ticket: sign(toolRequest), fixture: body.fixture, variant: body.variant }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "complete") throw new Error("未知操作");
    const toolRequest: ToolRequest = body.envelope?.request;
    const ticket = body.envelope?.ticket;
    if (!toolRequest || typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket) || !timingSafeEqual(Buffer.from(ticket, "hex"), Buffer.from(sign(toolRequest), "hex"))) throw new Error("请求签名不匹配");
    const result: ToolResult = body.result;
    if (!result || !["passed", "failed", "cancelled", "timeout", "tool-error"].includes(result.status) || !validateResult(toolRequest, result)) throw new Error("结果缺失、错任务或与检查计划不匹配");
    const expired = Date.now() >= toolRequest.deadline;
    const status = expired ? "timeout" : result.status;
    return Response.json({ taskId: toolRequest.taskId, requestId: toolRequest.requestId, codeHash: toolRequest.codeHash, status, detail: expired ? "任务已超时，迟到结果不能成为成功证据。" : status === "passed" ? "确定性任务已收到同一代码的完整浏览器结果；仅所列检查通过。" : result.detail }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "检查协议错误" }, { status: 400 }); }
}
