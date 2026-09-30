import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createRecorder } from "../execution";
import { previewHeadOffset } from "../html-document";
import { validateRequest, validateResult, type ToolRequest, type ToolResult } from "../qa/contract";
import { completePlan, TEAM_PROTOCOL, TEAM_TIMEOUT_MS, type Delivery, type ModelCall, type PlatformProbe, type Specification, type TeamRecord } from "./contract";

// Ephemeral, single process task ownership. A missing owner fails closed (410),
// never recreates a paid task or resets its budget. Container uses one Node worker.
type Session = { token: string; deadline: number; lease: number; process: ChildProcessWithoutNullStreams; pending?: { request: ToolRequest; ticket: string }; check?: ToolResult; stop: (reason?: string) => void };
const globalTasks = globalThis as typeof globalThis & { atomsTeamTasks?: Map<string, Session>; atomsTeamKey?: Buffer };
const tasks = globalTasks.atomsTeamTasks ??= new Map();
const signingKey = globalTasks.atomsTeamKey ??= randomBytes(32);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sign = (request: ToolRequest) => createHmac("sha256", signingKey).update(JSON.stringify(request)).digest("hex");
const equalSecret = (a: unknown, b: string) => typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));


// HTTP start negotiates a signed, short-lived task ticket. Only the container
// gateway can consume it, over the same socket that carries tool feedback.
export async function teamEntry(request: Request) {
  if (process.env.NODE_ENV === "production" && !process.env.QA_TOOL_SIGNING_KEY) return Response.json({error:"团队签名配置缺失，未调用模型。"},{status:503});
  const key = process.env.QA_TOOL_SIGNING_KEY || signingKey;
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest("hex");
  if (process.env.ATOMS_INTERNAL_KEY && equalSecret(request.headers.get("x-atoms-internal"), process.env.ATOMS_INTERNAL_KEY)) {
    try {
      const { ticket } = await request.json();
      if (!ticket || typeof ticket.payload !== "string" || ticket.payload.length > 30_000 || !equalSecret(ticket.signature, mac(ticket.payload))) throw new Error();
      const payload = JSON.parse(ticket.payload);
      if (!Number.isFinite(payload.started) || payload.started > Date.now() || Date.now() >= payload.started + TEAM_TIMEOUT_MS) throw new Error();
      const internal = new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Atoms-Task-Id": payload.taskId }, body: JSON.stringify(payload.body), signal: request.signal });
      return startTeam(internal, payload.started);
    } catch { return Response.json({error:"团队票据无效或已过期"},{status:400}); }
  }
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({error:"非法来源"},{status:403});
  if (!process.env.ATOMS_INTERNAL_KEY) return Response.json({error:"四角色需要通过团队连接网关启动，尚未配置运行环境。"},{status:503});
  try {
    const raw = await request.text(); if(raw.length > 20_000) throw new Error();
    const body = JSON.parse(raw), taskId = request.headers.get("x-atoms-task-id");
    if(!/^[a-f0-9-]{36}$/.test(taskId ?? "") || typeof body.requirement !== "string" || !body.requirement.trim() || body.requirement.length>4000 || !/^[a-f0-9-]{36}$/.test(body.projectId)) throw new Error();
    const payload = JSON.stringify({taskId, body, started:Date.now()});
    return Response.json({protocol:TEAM_PROTOCOL, transport:"websocket", taskId, ticket:{payload,signature:mac(payload)}},{headers:{"Cache-Control":"no-store"}});
  } catch {return Response.json({error:"团队任务输入无效"},{status:400});}
}

export async function teamControl(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "非法来源" }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 3_000_000) throw new Error("工具回传过大");
    const body = JSON.parse(raw);
    const session = tasks.get(body.taskId);
    if (!session || !equalSecret(body.token, session.token)) return Response.json({ error: "任务已结束或执行实例不可用，请重新发起。" }, { status: 410 });
    if (Date.now() >= session.deadline || Date.now() - session.lease > 15_000) { session.stop("任务超时或浏览器已断线。"); return Response.json({ error: "任务已过期" }, { status: 410 }); }
    if (body.action === "cancel") { session.stop("页面已离开，本次任务已停止。"); return Response.json({ ok: true }); }
    if (body.action === "heartbeat") { session.lease = Date.now(); return Response.json({ ok: true }); }
    const pending = session.pending;
    if (body.action !== "tool-result" || !pending || !equalSecret(body.ticket, pending.ticket) || !body.result || !validateResult(pending.request, body.result) || !["passed", "failed", "timeout", "cancelled", "tool-error"].includes(body.result.status)) throw new Error("检查结果缺失、错任务、旧请求或与必检计划不符");
    session.pending = undefined;
    session.check = body.result;
    session.process.stdin.write(JSON.stringify(body.result) + "\n");
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "检查协议错误" }, { status: 400 }); }
}

export async function startTeam(request: Request, started = Date.now()) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "请从本网站发起生成。" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "请求格式错误" }, { status: 415 });
  let body;
  try { const raw = await request.text(); if (raw.length > 20_000) throw new Error(); body = JSON.parse(raw); } catch { return Response.json({ error: "请求无效或过大" }, { status: 400 }); }
  const taskId = request.headers.get("x-atoms-task-id") ?? "";
  if (!body || typeof body !== "object" || Array.isArray(body) || !/^[a-f0-9-]{36}$/.test(taskId) || !/^[a-f0-9-]{36}$/.test(body.projectId) || typeof body.requirement !== "string" || !body.requirement.trim() || body.requirement.length > 4000 || body.modification !== undefined || body.baseHtml !== undefined || body.context !== undefined) return Response.json({ error: "首次团队任务输入无效" }, { status: 400 });
  if (!process.env.DEEPSEEK_API_KEY || !process.env.ATOMS_TEAM_PYTHON) return Response.json({ error: "四角色运行环境尚未配置，未调用模型。" }, { status: 503 });
  if (tasks.has(taskId) || tasks.size >= 2) return Response.json({ error: "生成执行器繁忙，请稍后重试。" }, { status: 429 });
  const deadline = started + TEAM_TIMEOUT_MS;
  const token = randomBytes(32).toString("hex");
  let cancelled = false;
  let stop: (reason?: string) => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let terminal = false;
      const send = (value: unknown) => { if (!cancelled && !terminal) controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n")); };
      const record = createRecorder(taskId, "server", event => send({ type: "step", event }));
      const team: TeamRecord = { protocol: TEAM_PROTOCOL, taskId, projectId: body.projectId, calls: [], deliveries: [] };
      const child = spawn(process.env.ATOMS_TEAM_PYTHON!, [path.join(process.cwd(), "runtime/team/runner.py")], { env: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY, ALL_PROXY: process.env.ALL_PROXY, NO_PROXY: process.env.NO_PROXY, PATH: process.env.PATH, HOME: process.env.ATOMS_TEAM_HOME ?? process.env.HOME, METAGPT_PROJECT_ROOT: process.env.METAGPT_PROJECT_ROOT, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, PYTHONUNBUFFERED: "1" }, stdio: "pipe" });
      // Never forward framework stderr: it may include full prompts/tracebacks.
      child.stderr.resume();
      const cleanup = () => { clearInterval(watchdog); clearTimeout(hardTimeout); request.signal.removeEventListener("abort", abort); tasks.delete(taskId); child.stdin.destroy(); child.kill("SIGKILL"); };
      stop = (reason = "任务已停止") => { if (terminal) return; record("team", "四角色生成", "failed", reason); send({ type: "error", taskId, error: reason, team }); terminal = true; cleanup(); if (!cancelled) controller.close(); };
      const session: Session = { token, deadline, lease: Date.now(), process: child, stop };
      tasks.set(taskId, session);
      const abort = () => stop("生成连接已断开，停止后续步骤。");
      request.signal.addEventListener("abort", abort, { once: true });
      const watchdog = setInterval(() => { if (Date.now() >= deadline) stop("任务已达到 4 分钟上限。"); else if (Date.now() - session.lease > 15_000) stop("浏览器已断线，停止后续步骤。"); }, 500);
      const hardTimeout = setTimeout(() => stop("任务已达到 4 分钟上限。"), Math.max(1, Math.min(TEAM_TIMEOUT_MS, deadline - Date.now())));
      send({ type: "session", protocol: TEAM_PROTOCOL, taskId, projectId: body.projectId, token, deadline });
      record("team", "启动 MetaGPT 四角色", "started", "原生 Team/MGXEnv 调度；每任务最多 4 分钟、20 次模型请求。请保持页面打开。");
      child.stdin.write(JSON.stringify({ taskId, projectId: body.projectId, requirement: body.requirement.trim(), deadline }) + "\n");
      let buffer = "";
      let bytes = 0;
      let frozenSpec: Specification | undefined;
      let generatedHash: string | undefined;
      let candidateResult: { html: string; assistantReply: string; codeHash: string } | undefined;
      const handle = (message: Record<string, unknown>) => {
        if (terminal) return;
        if (Date.now() >= deadline) return stop("任务已超时，拒绝迟到结果。");
        if (message.type === "call") {
          const call = message as unknown as ModelCall;
          if (!Number.isInteger(call.call) || call.call < 1 || call.call > 20 || !["Mike", "Requirements", "Engineer", "Verifier"].includes(call.actor)) throw new Error("模型调用计量无效");
          const index = team.calls.findIndex(c => c.call === call.call);
          if (call.status === "started") { if (index !== -1 || call.call !== team.calls.length + 1) throw new Error("模型调用重复或缺失"); team.calls.push(call); }
          else { if (index === -1 || team.calls[index].status !== "started") throw new Error("模型响应计量不匹配"); team.calls[index] = call; }
          record(`model-${call.call}`, `${call.actor} · 模型请求 ${call.call}/20`, call.status, call.status === "started" ? "已发起 deepseek-flash 请求。" : JSON.stringify(call));
          send({ type: "call", taskId, call });
        } else if (message.type === "notice") {
          if (typeof message.detail !== "string" || !["transport-retry", "format-retry", "plan-validation", "spec-validation"].includes(String(message.kind))) throw new Error("平台通知格式错误");
          record(`notice-${team.calls.length}`, message.kind === "transport-retry" ? "平台 · 连接重试" : message.kind === "format-retry" ? "平台 · JSON 解析重试" : message.kind === "spec-validation" ? "平台 · 需求规格格式校验" : "平台 · 检查计划格式校验", message.kind === "transport-retry" ? "completed" : "failed", message.detail);
        } else if (message.type === "diagnostic") {
          if (typeof message.content !== "string" || message.content.length > 600_000) throw new Error("模型诊断输出过大");
          record(`parse-${team.calls.length}`, "平台 · 模型产物解析失败", "failed", JSON.stringify({actor:message.actor,error:message.detail,rawOutput:message.content}));
        } else if (message.type === "delivery") {
          const delivery = message as unknown as Delivery;
          if (!['Mike','Requirements','Engineer','Verifier'].includes(delivery.role) || typeof delivery.content !== "string" || delivery.content.length > 150_000) throw new Error("角色交付无效");
          if (delivery.role === "Requirements") { if (frozenSpec) throw new Error("需求规格不能替换"); frozenSpec = JSON.parse(delivery.content); }
          if (delivery.role === "Engineer") generatedHash = JSON.parse(delivery.content).codeHash;
          team.deliveries.push(delivery); send({ type: "delivery", taskId, delivery });
        } else if (message.type === "tool") {
          if (!frozenSpec || session.pending || session.check || typeof message.html !== "string" || (message.html.match(/<!doctype html>/gi)?.length ?? 0) !== 1 || previewHeadOffset(message.html) === null || hash(message.html) !== generatedHash || JSON.stringify(message.spec) !== JSON.stringify(frozenSpec)) throw new Error("工具请求与冻结规格或代码不符");
          const scenarios = completePlan(frozenSpec, message.scenarios as ToolRequest["scenarios"], message.probe as PlatformProbe);
          const toolRequest: ToolRequest = { protocol: "atoms-qa/1", taskId, requestId: randomUUID(), codeHash: hash(message.html), planHash: hash(JSON.stringify(scenarios)), html: message.html, deadline, scenarios };
          validateRequest(toolRequest);
          session.pending = { request: toolRequest, ticket: sign(toolRequest) };
          record("qa", "验证工程师请求浏览器检查", "started", "固定平台检查与本次需求的全部业务检查；只使用合成数据。");
          send({ type: "tool", taskId, envelope: session.pending });
        } else if (message.type === "failure") stop(typeof message.error === "string" ? message.error : "团队执行失败");
        else if (message.type === "result") {
          if (candidateResult || !session.check || session.check.status !== "passed" || typeof message.html !== "string" || hash(message.html) !== session.check.codeHash || message.codeHash !== generatedHash || previewHeadOffset(message.html) === null || typeof message.assistantReply !== "string" || !["Mike","Requirements","Engineer","Verifier"].every(actor => team.calls.some(c => c.actor === actor && c.status === "completed"))) throw new Error("缺少当前代码的完整 QA 或角色执行证据");
          candidateResult = message as unknown as typeof candidateResult;
        } else throw new Error("未知团队事件");
      };
      child.stdout.on("data", (chunk: Buffer) => {
        // StringDecoder preserves Chinese UTF-8 split across pipe chunks.
        buffer += decoder.write(chunk); bytes += chunk.length;
        try {
          if (bytes > 4_000_000) throw new Error("团队输出超过限制");
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line.trim()) handle(JSON.parse(line)); }
        } catch (error) { stop(error instanceof Error ? error.message : "团队协议错误"); }
      });
      const decoder = new StringDecoder("utf8");
      child.stdin.on("error", () => stop("团队输入通道已关闭，未交付结果。"));
      child.stdout.on("error", () => stop("团队输出通道中断，未交付结果。"));
      child.on("error", () => stop("Python 团队执行器无法启动。"));
      child.on("close", code => {
        if (terminal) return;
        buffer += decoder.end();
        if (code !== 0 || buffer.trim() || !candidateResult || Date.now() >= deadline) return stop("团队进程未正常完成，未交付结果。");
        team.check = session.check; team.codeHash = generatedHash; team.durationMs = Date.now() - started;
        record("qa", "浏览器必检项通过", "completed", `当前代码 ${generatedHash}；${session.check!.results.length} 项实际检查通过。`);
        record("team", "TeamLeader 确认交付", "completed", `${team.calls.length} 次实际请求，总耗时 ${team.durationMs} ms。`);
        send({ type: "result", protocol: TEAM_PROTOCOL, taskId, team, assistantReply: candidateResult.assistantReply, result: { html: candidateResult.html, model: team.calls.filter(c => c.responseModel).at(-1)?.responseModel ?? "deepseek-flash", durationMs: team.durationMs, generatedAt: new Date().toISOString() } });
        terminal = true; cleanup(); controller.close();
      });
      if (request.signal.aborted) abort();
    },
    cancel() { cancelled = true; stop(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
import { StringDecoder } from "node:string_decoder";
