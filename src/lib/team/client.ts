import { openTeamSocket } from "./socket";
import type { ExecutionEvent } from "../execution";
import type { GenerationResult } from "../generation";
import { previewHeadOffset } from "../html-document";
import { reviewedTeam } from "./review";
import { sha256 } from "../qa/contract";
import { TEAM_PROTOCOL, TeamError, isTeamOutcome, type TeamRecord } from "./contract";

export async function readTeam(response: Response, taskId: string, projectId: string, signal: AbortSignal, onStep: (event: ExecutionEvent) => void, onTeam: (team: TeamRecord) => void, baseHtml?: string) {
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "团队服务不可用");
  const baseCodeHash = baseHtml === undefined ? undefined : await sha256(baseHtml);
  let socket: Awaited<ReturnType<typeof openTeamSocket>> | undefined;
  if (response.headers.get("content-type")?.includes("application/json")) {
    const handshake = await response.json();
    if(handshake.protocol !== TEAM_PROTOCOL || handshake.transport !== "websocket" || handshake.taskId !== taskId) throw new Error("生成任务需要四角色审查协议；旧 HTML 响应未被接受。");
    socket = await openTeamSocket(handshake.ticket, signal); response = socket.response;
  }
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("生成任务需要四角色审查协议；旧 HTML 响应未被接受。");
  let token = "", sequence = 0, buffer = "", total = 0, heartbeat: ReturnType<typeof setInterval> | undefined;
  let team: TeamRecord = { protocol: TEAM_PROTOCOL, taskId, projectId, deliveries: [], calls: [] };
  let outcome: { result: GenerationResult; assistantReply: string | null; team: TeamRecord } | undefined;
  let receivedTerminal = false;
  const control = async (action: string, extra = {}) => {
    if(socket) return socket.control({action,taskId,token,...extra});
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, taskId, token, ...extra }), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!r.ok) throw new Error((await r.json()).error || "团队控制连接中断");
  };
  const cancel = () => { if(socket) {socket.close(); return;} if (token) void fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", taskId, token }), keepalive: true }).catch(() => {}); };
  const onAbort = () => { cancel(); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  window.addEventListener("pagehide", cancel);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (signal.aborted) onAbort();
  let transportError: Error | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (transportError) throw transportError;
      signal.throwIfAborted();
      total += value?.length ?? 0;
      if (total > 4_000_000) throw new Error("团队响应过大");
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (outcome) throw new Error("终态后收到意外事件");
        if (m.type === "step") {
          const event = m.event as ExecutionEvent;
          if (event.taskId !== taskId || event.source !== "server" || event.sequence !== ++sequence || !["started","completed","failed"].includes(event.status) || [event.label,event.detail,event.stepId,event.at].some(v => typeof v !== "string")) throw new Error("团队步骤归属或顺序错误");
          onStep(event); continue;
        }
        if (m.taskId !== taskId) throw new Error("错任务团队结果");
        if (m.type === "session") {
          if (token || m.protocol !== TEAM_PROTOCOL || m.projectId !== projectId || typeof m.token !== "string") throw new Error("团队会话协议不匹配");
          token = m.token;
          heartbeat = setInterval(() => { void control("heartbeat").catch(error => { if (!receivedTerminal) { transportError = error; void reader.cancel(); cancel(); } }); }, 4000);
        } else if (!token) throw new Error("缺少团队会话");
        else if (m.type === "delivery") { team = { ...team, deliveries: [...team.deliveries, m.delivery], ...(m.delivery.role === "Engineer" ? {review:undefined} : {}), ...(m.delivery.role === "Reviewer" ? {review:JSON.parse(m.delivery.content)} : {}) }; onTeam(team); }
        else if (m.type === "call") { team = { ...team, calls: [...team.calls.filter(c => c.call !== m.call.call), m.call].sort((a,b) => a.call-b.call) }; onTeam(team); }
        else if (m.type === "error") {
          receivedTerminal = true; clearInterval(heartbeat);
          const outcome = isTeamOutcome(m.outcome) && m.outcome !== "passed" ? m.outcome : "failed";
          team = {...team, outcome}; onTeam(team);
          throw new TeamError(outcome, m.error || "团队执行失败");
        }
        else if (m.type === "result") {
          receivedTerminal = true; clearInterval(heartbeat);
          if (m.protocol !== TEAM_PROTOCOL || !m.team || m.team.taskId !== taskId || m.team.projectId !== projectId || m.team.baseCodeHash !== baseCodeHash || typeof m.result?.html !== "string" || !reviewedTeam(m.team, await sha256(m.result.html)) || previewHeadOffset(m.result.html) === null || !Number.isFinite(m.result.durationMs) || (m.assistantReply !== null && typeof m.assistantReply !== "string")) throw new Error("缺少完整团队交付或当前代码的通过审查");
          outcome = { result: m.result, assistantReply: m.assistantReply, team: m.team };
        } else throw new Error("未知团队事件");
      }
      if (done) break;
    }
    if (buffer.trim() || !outcome) throw new Error("团队连接中断，未正常交付。");
    return outcome;
  } finally {
    clearInterval(heartbeat); if (!outcome) cancel(); socket?.close();
    signal.removeEventListener("abort", onAbort); window.removeEventListener("pagehide", cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
