import { createRecorder, type ExecutionEvent } from "../execution";
import { runBrowserCheck } from "./browser-tool";
import { validateResult, type CheckResult, type ToolRequest, type ToolResult } from "./contract";

export type QaEnvelope = { request: ToolRequest; ticket: string; fixture: string; variant: string };
export type QaCompletion = { taskId: string; requestId: string; codeHash: string; status: ToolResult["status"]; detail: string };
// Awaitable task tool adapter. The same task waits for its tool, validates it,
// and resumes through the HTTP continuation. No results are manually entered.
export async function runQualificationTask(fixture: string, variant: string, host: HTMLElement, signal: AbortSignal, onRequest: (request: ToolRequest) => void, onResult: (row: CheckResult) => void, emit: (event: ExecutionEvent) => void, onToolResult: (result: ToolResult) => void): Promise<QaCompletion> {
  const taskId = crypto.randomUUID();
  const record = createRecorder(taskId, "browser", emit);
  const post = async (body: unknown) => {
    const response = await fetch("/api/qa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
    return response.json();
  };
  record("qa-request", "请求受限检查", "started", "确定性资格验证任务；零模型调用。");
  const envelope: QaEnvelope = await post({ action: "start", taskId, fixture, variant });
  if (envelope.request.taskId !== taskId) throw new Error("错任务工具请求");
  onRequest(envelope.request);
  record("qa-request", "请求受限检查", "completed", `代码 SHA-256 ${envelope.request.codeHash}`);
  record("qa-browser", "浏览器执行检查", "started", "独立 opaque-origin iframe，仅合成检查数据。");
  const result = await runBrowserCheck(envelope.request, host, signal, onResult);
  onToolResult(result);
  if (!validateResult(envelope.request, result)) throw new Error("工具结果与任务、代码或必检计划不匹配");
  record("qa-browser", "浏览器执行检查", result.status === "passed" ? "completed" : "failed", result.detail);
  if (signal.aborted) return { ...result, status: "cancelled" };
  record("qa-return", "回传并继续同一任务", "started", "后端核对签名、归属、代码和每项实际结果。");
  const completion: QaCompletion = await post({ action: "complete", envelope, result });
  if (signal.aborted || completion.taskId !== taskId || completion.requestId !== result.requestId || completion.codeHash !== result.codeHash) throw new Error("迟到或错任务结果");
  record("qa-return", "回传并继续同一任务", completion.status === "passed" ? "completed" : "failed", completion.detail);
  return completion;
}
