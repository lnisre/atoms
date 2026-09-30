import { MAX_ASSISTANT_LENGTH, MAX_HTML_LENGTH, type GenerationResult } from "./generation";
import type { ExecutionEvent } from "./execution";
import { previewHeadOffset } from "./html-document";

function validateResult(value: unknown): GenerationResult {
  const result = value as GenerationResult;
  if (!result || typeof result.html !== "string" || result.html.length > MAX_HTML_LENGTH || previewHeadOffset(result.html) === null || !/^<!doctype html>/i.test(result.html) || !/<\/html>\s*$/i.test(result.html) || typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) || typeof result.generatedAt !== "string" || typeof result.model !== "string")
    throw new Error("生成结果不完整，请重新发起。");
  return { html: result.html, durationMs: result.durationMs, generatedAt: result.generatedAt, model: result.model };
}
function reply(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.length > MAX_ASSISTANT_LENGTH) throw new Error("助手说明超过长度限制，未截断结果。");
  return value;
}

export async function readGeneration(response: Response, taskId: string, onStep: (event: ExecutionEvent) => void) {
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "生成服务未能完成请求，请稍后重试。");
  }
  // Rolling deployment compatibility: old servers return a single JSON result,
  // with no invented server events or historical explanation.
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data = await response.json();
    return { result: validateResult(data), assistantReply: reply(data.assistantReply) };
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson") || !response.body)
    throw new Error("生成连接格式异常，请重新发起。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  let sequence = 0;
  let outcome: { result: GenerationResult; assistantReply: string | null } | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      total += value?.byteLength ?? 0;
      if (total > 4_000_000) throw new Error("生成响应超过长度限制，未截断结果。");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (outcome) throw new Error("生成终态后收到意外数据，请重新发起。");
        if (message.type === "step") {
          const event = message.event as ExecutionEvent;
          if (!event || event.taskId !== taskId || event.source !== "server" || event.sequence !== sequence + 1 || !["started", "completed", "failed"].includes(event.status) || [event.stepId, event.label, event.detail, event.at].some(v => typeof v !== "string") || !Number.isFinite(Date.parse(event.at)))
            throw new Error("生成事件不完整或任务不匹配，请重新发起。");
          sequence = event.sequence;
          onStep(event);
        } else if (message.taskId !== taskId) {
          throw new Error("生成结果与任务不匹配，请重新发起。");
        } else if (message.type === "error" && typeof message.error === "string") {
          throw new Error(message.error);
        } else if (message.type === "result") {
          outcome = { result: validateResult(message.result), assistantReply: reply(message.assistantReply) };
        } else throw new Error("无法读取生成事件，请重新发起。");
      }
      if (done) break;
    }
    if (buffer.trim() || !outcome) throw new Error("生成传输中断，未取得完整结果，请手动重试。");
    return outcome;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
