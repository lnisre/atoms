import { openTeamSocket } from "./socket";
import type { ExecutionEvent } from "../execution";
import type { GenerationResult } from "../generation";
import { previewHeadOffset } from "../html-document";
import { artifactTeam, inspectDeliveries, validClassifiedReview, type ReviewIssue } from "./review";
import { sha256 } from "../qa/contract";
import { TEAM_PROTOCOL, TeamError, isTeamOutcome, type TeamRecord } from "./contract";
class ProtocolError extends Error {}
export async function readTeam(response: Response, taskId: string, projectId: string, signal: AbortSignal, onStep: (event: ExecutionEvent) => void, onTeam: (team: TeamRecord) => void, baseHtml?: string, baseDataIssues: ReviewIssue[] = []) {
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "团队服务不可用");
  const baseCodeHash = baseHtml === undefined ? undefined : await sha256(baseHtml);
  let socket: Awaited<ReturnType<typeof openTeamSocket>> | undefined;
  if (response.headers.get("content-type")?.includes("application/json")) {
    const handshake = await response.json();
    if(handshake.protocol !== TEAM_PROTOCOL || handshake.transport !== "websocket" || handshake.taskId !== taskId) throw new ProtocolError("团队协议已更新，旧 HTML 响应未被接受；请刷新页面后重试。");
    socket = await openTeamSocket(handshake.ticket, signal); response = socket.response;
  }
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw new ProtocolError("缺少团队交付协议。");
  let token = "", sequence = 0, buffer = "", total = 0, heartbeat: ReturnType<typeof setInterval> | undefined;
  let team: TeamRecord = { protocol: TEAM_PROTOCOL, taskId, projectId, baseCodeHash, ...(baseHtml ? {baseDataIssues} : {}), deliveries: [], calls: [] };
  type Received = { proof?: import("../cloud-projects/artifact-contract").ArtifactProof; result: GenerationResult; assistantReply: string | null; team: TeamRecord };
  let cached: Received | undefined, outcome: Received | undefined;
  let receivedTerminal = false, transportFailed = false;
  const control = async () => {
    if(socket) return socket.control({action:"heartbeat",taskId,token});
    const r = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action:"heartbeat", taskId, token }), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!r.ok) throw new Error("团队控制连接中断");
  };
  const cancel = () => { if(socket) {socket.close(); return;} if (token) void fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", taskId, token }), keepalive: true }).catch(() => {}); };
  const reader = response.body.getReader();
  const onAbort = () => { cancel(); void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  window.addEventListener("pagehide", cancel);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  if (signal.aborted) onAbort();
  const accept = async (m: Record<string, unknown>, terminal: boolean): Promise<Received> => {
    const t = m.team as TeamRecord, result = m.result as GenerationResult;
    if (m.protocol !== TEAM_PROTOCOL || !t || t.taskId !== taskId || t.projectId !== projectId || t.baseCodeHash !== baseCodeHash || JSON.stringify(t.baseDataIssues ?? []) !== JSON.stringify(baseDataIssues) || typeof result?.html !== "string" || result.html.length > 500000 || !artifactTeam(t,await sha256(result.html),terminal) || previewHeadOffset(result.html) === null || !Number.isFinite(result.durationMs) || typeof result.generatedAt !== "string" || (m.assistantReply !== null && typeof m.assistantReply !== "string") || (t.review && !validClassifiedReview(t.review,t.codeHash!,result.html))) throw new ProtocolError("缺少完整且归属正确的代码产物或角色记录");
    if (team.deliveries.length && (JSON.stringify(t.deliveries) !== JSON.stringify(team.deliveries) || JSON.stringify(t.calls) !== JSON.stringify(team.calls))) throw new ProtocolError("结果与实际角色交接不一致");
    return {result,assistantReply:m.assistantReply as string|null,team:t, ...(terminal && m.proof ? {proof:m.proof as import("../cloud-projects/artifact-contract").ArtifactProof} : {})};
  };
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (error) { transportFailed = true; throw error; }
      const {done,value} = chunk;
      signal.throwIfAborted();
      if (transportFailed) throw new Error("团队连接中断");
      total += value?.length ?? 0;
      if (total > 16_000_000) throw new ProtocolError("团队响应过大");
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (receivedTerminal) throw new ProtocolError("终态后收到意外事件");
        if (m.type === "step") {
          const event = m.event as ExecutionEvent;
          if (event.taskId !== taskId || event.source !== "server" || event.sequence !== ++sequence || !["started","completed","failed"].includes(event.status) || [event.label,event.detail,event.stepId,event.at].some(v => typeof v !== "string")) throw new ProtocolError("团队步骤归属或顺序错误");
          onStep(event); continue;
        }
        if (m.taskId !== taskId) throw new ProtocolError("错任务团队结果");
        if (m.type === "session") {
          if (token || m.protocol !== TEAM_PROTOCOL || m.projectId !== projectId || typeof m.token !== "string") throw new ProtocolError("团队会话协议不匹配");
          token = m.token;
          heartbeat = setInterval(() => { void control().catch(() => { if (!receivedTerminal) { transportFailed = true; void reader.cancel().catch(() => {}); cancel(); } }); },4000);
        } else if (!token) throw new ProtocolError("缺少团队会话");
        else if (m.type === "delivery") {
          const deliveries = [...team.deliveries,m.delivery];
          if (!(m.delivery.role === "Requirements" && !JSON.parse(m.delivery.content).requirements)) inspectDeliveries(taskId,deliveries,TEAM_PROTOCOL);
          const review = m.delivery.role === "Reviewer" ? JSON.parse(m.delivery.content) : undefined;
          if (review && (!cached || !validClassifiedReview(review,cached.team.codeHash!,cached.result.html))) throw new ProtocolError("审查与已收代码不符");
          team = { ...team, deliveries, ...(m.delivery.role === "Engineer" ? {review:undefined} : {}), ...(review ? {review} : {}) }; onTeam(team);
        } else if (m.type === "call") { team = { ...team, calls: [...team.calls.filter(c => c.call !== m.call.call), m.call].sort((a,b)=>a.call-b.call) }; onTeam(team); }
        else if (m.type === "artifact") { cached = await accept(m,false); team = cached.team; }
        else if (m.type === "error") {
          receivedTerminal = true; clearInterval(heartbeat);
          const end = isTeamOutcome(m.outcome) && !["passed","issues"].includes(m.outcome) ? m.outcome : "failed";
          if (m.result) { outcome = await accept(m,true); if (outcome.team.outcome !== end) throw new ProtocolError("结束状态不一致"); team=outcome.team; onTeam(team); }
          else { team={...team,outcome:end}; onTeam(team); throw new TeamError(end,m.error || "团队执行失败"); }
        } else if (m.type === "result") {
          receivedTerminal = true; clearInterval(heartbeat);
          outcome = await accept(m,true); team=outcome.team; onTeam(team);
        } else throw new ProtocolError("未知团队事件");
      }
      if (done) break;
    }
    if (buffer.trim()) throw new ProtocolError("团队消息不完整");
    if (!outcome) { transportFailed=true; throw new Error("团队连接中断，未正常结束。"); }
    return outcome;
  } catch (error) {
    const timedOut = signal.aborted && signal.reason instanceof TeamError && signal.reason.outcome === "limit";
    if (cached && !receivedTerminal && (timedOut || (!signal.aborted && transportFailed && !(error instanceof ProtocolError)))) {
      const savedTeam: TeamRecord = {...team,codeHash:cached.team.codeHash,outcome:timedOut ? "limit" : "failed"};
      if (artifactTeam(savedTeam,cached.team.codeHash!,true)) { onTeam(savedTeam); return {...cached,team:savedTeam}; }
    }
    throw error;
  } finally {
    clearInterval(heartbeat); if (!outcome) cancel(); socket?.close();
    signal.removeEventListener("abort",onAbort); window.removeEventListener("pagehide",cancel);
    await reader.cancel().catch(()=>{}); reader.releaseLock();
  }
}
