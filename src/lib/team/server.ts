import { authFailure, requireAccount, checkOrigin } from "../auth/server";
import { MAX_REQUEST_LENGTH } from "../generation";
import { validTeamInput } from "./input";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { createRecorder } from "../execution";
import { previewHeadOffset } from "../html-document";
import { validClassifiedReview, artifactTeam, inspectDeliveries } from "./review";
import { TEAM_PROTOCOL, TEAM_TIMEOUT_MS, isTeamOutcome, type TeamOutcome, type Delivery, type ModelCall, type Specification, type TeamRecord } from "./contract";

// Ephemeral, single process task ownership. A missing owner fails closed (410),
// never recreates a paid task or resets its budget. Container uses one Node worker.
type Session = { ownerId: string; token: string; deadline: number; lease: number; process: ChildProcessWithoutNullStreams; stop: (reason?: string, outcome?: TeamOutcome) => void };
const globalTasks = globalThis as typeof globalThis & { atomsTeamTasks?: Map<string, Session>; atomsTeamKey?: Buffer };
const tasks = globalTasks.atomsTeamTasks ??= new Map();
const signingKey = globalTasks.atomsTeamKey ??= randomBytes(32);
const consumedTickets = new Map<string, number>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const equalSecret = (a: unknown, b: string) => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));


// HTTP start negotiates a signed, short-lived task ticket. Only the container
// gateway can consume it, over the same socket that carries tool feedback.
export async function teamEntry(request: Request) {
  let account;
  try { account = await requireAccount(request); } catch (error) { return authFailure(error); }
  if (process.env.NODE_ENV === "production" && !process.env.QA_TOOL_SIGNING_KEY) return Response.json({error:"团队签名配置缺失，未调用模型。"},{status:503});
  const key = process.env.QA_TOOL_SIGNING_KEY || signingKey;
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest("hex");
  if (process.env.ATOMS_INTERNAL_KEY && equalSecret(request.headers.get("x-atoms-internal"), process.env.ATOMS_INTERNAL_KEY)) {
    try {
      const { ticket } = await request.json();
      if (!ticket || typeof ticket.payload !== "string" || ticket.payload.length > MAX_REQUEST_LENGTH + 1000 || !equalSecret(ticket.signature, mac(ticket.payload))) throw new Error();
      const payload = JSON.parse(ticket.payload);
      if (payload.ownerId !== account.id) throw new Error();
      if (!Number.isFinite(payload.started) || payload.started > Date.now() || Date.now() >= payload.started + TEAM_TIMEOUT_MS) throw new Error();
      for (const [id, deadline] of consumedTickets) if (deadline <= Date.now()) consumedTickets.delete(id);
      if (consumedTickets.has(payload.taskId)) return Response.json({ error: "这次生成已启动，请勿重复提交。" }, { status: 409 });
      consumedTickets.set(payload.taskId, payload.started + TEAM_TIMEOUT_MS);
      const internal = new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Atoms-Task-Id": payload.taskId }, body: JSON.stringify(payload.body), signal: request.signal });
      return startTeam(internal, payload.started, account.id);
    } catch { return Response.json({error:"团队票据无效或已过期"},{status:400}); }
  }

  if (!process.env.ATOMS_INTERNAL_KEY) return Response.json({error:"四角色需要通过团队连接网关启动，尚未配置运行环境。"},{status:503});
  try {
    const raw = await request.text(); if(raw.length > MAX_REQUEST_LENGTH) throw new Error();
    const body = JSON.parse(raw), taskId = request.headers.get("x-atoms-task-id");
    if(!/^[a-f0-9-]{36}$/.test(taskId ?? "") || !validTeamInput(body)) throw new Error();
    const payload = JSON.stringify({taskId, body, ownerId: account.id, started:Date.now()});
    return Response.json({protocol:TEAM_PROTOCOL, transport:"websocket", taskId, ticket:{payload,signature:mac(payload)}},{headers:{"Cache-Control":"no-store"}});
  } catch {return Response.json({error:"团队任务输入无效"},{status:400});}
}

export async function teamControl(request: Request) {
  let ownerId: string | undefined;
  try {
    checkOrigin(request);
    if (!(process.env.ATOMS_INTERNAL_KEY && equalSecret(request.headers.get("x-atoms-internal"), process.env.ATOMS_INTERNAL_KEY)))
      ownerId = (await requireAccount(request)).id;
  } catch (error) { return authFailure(error); }

  try {
    const raw = await request.text();
    if (raw.length > 3_000_000) throw new Error("工具回传过大");
    const body = JSON.parse(raw);
    const session = tasks.get(body.taskId);
    if (!session || (ownerId !== undefined && ownerId !== session.ownerId) || !equalSecret(body.token, session.token)) return Response.json({ error: "任务已结束或执行实例不可用，请重新发起。" }, { status: 410 });
    if (Date.now() >= session.deadline || Date.now() - session.lease > 15_000) { session.stop("任务超时或浏览器已断线。", Date.now() >= session.deadline ? "limit" : "stopped"); return Response.json({ error: "任务已过期" }, { status: 410 }); }
    if (body.action === "cancel") { session.stop("本次任务已停止。", "stopped"); return Response.json({ ok: true }); }
    if (body.action === "heartbeat") { session.lease = Date.now(); return Response.json({ ok: true }); }
    throw new Error("不支持的团队控制操作");
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "检查协议错误" }, { status: 400 }); }
}

export async function startTeam(request: Request, started = Date.now(), ownerId = "") {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "请从本网站发起生成。" }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "请求格式错误" }, { status: 415 });
  let body;
  try { const raw = await request.text(); if (raw.length > MAX_REQUEST_LENGTH) throw new Error(); body = JSON.parse(raw); } catch { return Response.json({ error: "请求无效或过大" }, { status: 400 }); }
  const taskId = request.headers.get("x-atoms-task-id") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(taskId) || !validTeamInput(body)) return Response.json({ error: "团队任务输入无效" }, { status: 400 });
  if (!process.env.DEEPSEEK_API_KEY || !process.env.ATOMS_TEAM_PYTHON) return Response.json({ error: "四角色运行环境尚未配置，未调用模型。" }, { status: 503 });
  if (tasks.has(taskId) || tasks.size >= 2) return Response.json({ error: "生成执行器繁忙，请稍后重试。" }, { status: 429 });
  const deadline = started + TEAM_TIMEOUT_MS;
  const token = randomBytes(32).toString("hex");
  let cancelled = false;
  let stop: (reason?: string, outcome?: TeamOutcome, preserve?: boolean) => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let terminal = false;
      const send = (value: unknown) => { if (!cancelled && !terminal) controller.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n")); };
      const record = createRecorder(taskId, "server", event => send({ type: "step", event }));
      const team: TeamRecord = { protocol: TEAM_PROTOCOL, taskId, projectId: body.projectId, calls: [], deliveries: [], ...(body.baseHtml ? { baseCodeHash: hash(body.baseHtml), baseDataIssues: body.baseDataIssues ?? [] } : {}) };
      const child = spawn(process.env.ATOMS_TEAM_PYTHON!, [path.join(process.cwd(), "runtime/team/runner.py")], { env: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY, ALL_PROXY: process.env.ALL_PROXY, NO_PROXY: process.env.NO_PROXY, PATH: process.env.PATH, HOME: process.env.ATOMS_TEAM_HOME ?? process.env.HOME, METAGPT_PROJECT_ROOT: process.env.METAGPT_PROJECT_ROOT, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, PYTHONUNBUFFERED: "1" }, stdio: "pipe" });
      // Never forward framework stderr: it may include full prompts/tracebacks.
      child.stderr.resume();
      const cleanup = () => { clearInterval(watchdog); clearTimeout(hardTimeout); request.signal.removeEventListener("abort", abort); tasks.delete(taskId); child.stdin.destroy(); child.kill("SIGKILL"); };
      let artifact: { html: string; assistantReply: string; codeHash: string } | undefined;
      const resultOf = () => artifact && ({ html: artifact.html, model: team.calls.filter(c=>c.responseModel).at(-1)?.responseModel ?? "deepseek-flash", durationMs: Date.now()-started, generatedAt: new Date().toISOString() });
      stop = (reason = "任务已停止", outcome = "failed", preserve = true) => {
        if (terminal) return;
        team.outcome = outcome; team.durationMs = Date.now()-started;
        record("team", "四角色执行结束", "failed", reason);
        const available = preserve && artifact && !["stopped","clarification","unsupported"].includes(outcome) && artifactTeam(team,artifact.codeHash,true);
        send({ type: "error", protocol: TEAM_PROTOCOL, taskId, error: reason, outcome, team, ...(available ? {result:resultOf(),assistantReply:artifact!.assistantReply} : {}) });
        terminal = true; cleanup(); if (!cancelled) controller.close();
      };
      const session: Session = { ownerId, token, deadline, lease: Date.now(), process: child, stop };
      tasks.set(taskId, session);
      const abort = () => stop("生成连接已断开，停止后续步骤。", "stopped");
      request.signal.addEventListener("abort", abort, { once: true });
      const watchdog = setInterval(() => { if (Date.now() >= deadline) stop("任务已达到 4 分钟上限。", "limit"); else if (Date.now() - session.lease > 15_000) stop("浏览器已断线，停止后续步骤。", "stopped"); }, 500);
      const hardTimeout = setTimeout(() => stop("任务已达到 4 分钟上限。", "limit"), Math.max(1, Math.min(TEAM_TIMEOUT_MS, deadline - Date.now())));
      send({ type: "session", protocol: TEAM_PROTOCOL, taskId, projectId: body.projectId, token, deadline });
      record("team", "启动 MetaGPT 四角色", "started", "原生 Team/MGXEnv 调度；每任务最多 4 分钟、20 次模型请求。请保持页面打开。");
      child.stdin.write(JSON.stringify({ ...body, taskId, requirement: body.requirement.trim(), deadline }) + "\n");
      let buffer = "";
      let bytes = 0;
      let frozenSpec: Specification | undefined;
      let generatedHash: string | undefined;
      let candidateResult: { html: string; assistantReply: string; codeHash: string } | undefined;
      const handle = (message: Record<string, unknown>) => {
        if (terminal) return;
        if (Date.now() >= deadline) return stop("任务已超时，拒绝迟到结果。", "limit");
        if (message.type === "call") {
          const call = message as unknown as ModelCall;
          if (!Number.isInteger(call.call) || call.call < 1 || call.call > 20 || !["Mike", "Requirements", "Engineer", "Reviewer"].includes(call.actor)) throw new Error("模型调用计量无效");
          const index = team.calls.findIndex(c => c.call === call.call);
          if (call.status === "started") { if (index !== -1 || call.call !== team.calls.length + 1) throw new Error("模型调用重复或缺失"); team.calls.push(call); }
          else { if (index === -1 || team.calls[index].status !== "started") throw new Error("模型响应计量不匹配"); team.calls[index] = call; }
          record(`model-${call.call}`, `${call.actor} · 模型请求 ${call.call}/20`, call.status, call.status === "started" ? "已发起 deepseek-flash 请求。" : JSON.stringify(call));
          send({ type: "call", taskId, call });
        } else if (message.type === "notice") {
          if (typeof message.detail !== "string" || !["transport-retry", "format-retry", "review-validation", "spec-validation"].includes(String(message.kind))) throw new Error("平台通知格式错误");
          record(`notice-${team.calls.length}`, message.kind === "transport-retry" ? "平台 · 连接重试" : message.kind === "format-retry" ? "平台 · JSON 解析重试" : message.kind === "spec-validation" ? "平台 · 需求规格格式校验" : "平台 · 审查结果格式修正", message.kind === "spec-validation" ? "failed" : "completed", message.detail);
        } else if (message.type === "diagnostic") {
          if (typeof message.content !== "string" || message.content.length > 600_000) throw new Error("模型诊断输出过大");
          record(`parse-${team.calls.length}`, "平台 · 模型产物解析失败", "failed", JSON.stringify({actor:message.actor,error:message.detail,rawOutput:message.content}));
        } else if (message.type === "delivery") {
          const delivery = message as unknown as Delivery;
          if (!['Mike','Requirements','Engineer','Reviewer'].includes(delivery.role) || typeof delivery.content !== "string" || delivery.content.length > 650_000) throw new Error("角色交付无效");
          if (delivery.role === "Requirements" && JSON.parse(delivery.content).requirements) { if (frozenSpec) throw new Error("需求规格不能替换"); frozenSpec = JSON.parse(delivery.content); }
          if (delivery.role === "Engineer") {
            const value = JSON.parse(delivery.content);
            if (typeof value.html !== "string" || value.html.length > 500_000 || typeof value.assistantReply !== "string" || !value.assistantReply.trim() || value.assistantReply.length > 32000 || hash(value.html) !== value.codeHash || previewHeadOffset(value.html) === null) throw new Error("工程师代码与身份不符");
            generatedHash = value.codeHash; team.codeHash = generatedHash; team.review = undefined;
            // The executor owns full rejected code for repair; saved records keep
            // identities and explanations, not every historical HTML snapshot.
            artifact = {html:value.html,assistantReply:value.assistantReply,codeHash:value.codeHash};
            delete value.html; delivery.content = JSON.stringify(value);
          }
          if (delivery.role === "Reviewer") {
            const review = JSON.parse(delivery.content);
            if (!generatedHash || team.review || !validClassifiedReview(review, generatedHash, artifact?.html) || review.taskId !== taskId) throw new Error("代码审查与当前代码不符");
            team.review = review;
            record(`review-${team.deliveries.length}`, "Reviewer · 代码审查", "completed", review.summary);
          }
          // Clarification/unsupported is a terminal Requirements response, not a spec.
          if (!(delivery.role === "Requirements" && !JSON.parse(delivery.content).requirements)) inspectDeliveries(taskId, [...team.deliveries, delivery], TEAM_PROTOCOL);
          team.deliveries.push(delivery); send({ type: "delivery", taskId, delivery });
          if (delivery.role === "Engineer") send({type:"artifact",protocol:TEAM_PROTOCOL,taskId,team,result:resultOf(),assistantReply:artifact!.assistantReply});
        } else if (message.type === "failure") stop(typeof message.error === "string" ? message.error : "团队执行失败", isTeamOutcome(message.outcome) && message.outcome !== "passed" ? message.outcome : "failed");
        else if (message.type === "result") {
          if (candidateResult || !frozenSpec || typeof message.html !== "string" || hash(message.html) !== generatedHash || message.codeHash !== generatedHash || previewHeadOffset(message.html) === null || typeof message.assistantReply !== "string" || !message.assistantReply.trim() || !artifactTeam({...team,codeHash:generatedHash}, generatedHash) || !inspectDeliveries(taskId,team.deliveries,TEAM_PROTOCOL).finished) throw new Error("缺少当前代码的有效审查或四角色执行证据");
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
        } catch (error) { stop(error instanceof Error ? error.message : "团队协议错误", "failed", false); }
      });
      const decoder = new StringDecoder("utf8");
      child.stdin.on("error", () => stop("团队输入通道已关闭，未交付结果。"));
      child.stdout.on("error", () => stop("团队输出通道中断，未交付结果。"));
      child.on("error", () => stop("Python 团队执行器无法启动。"));
      child.on("close", code => {
        if (terminal) return;
        buffer += decoder.end();
        if (Date.now() >= deadline) return stop("任务已达到 4 分钟上限，拒绝迟到结果。", "limit");
        if (buffer.trim()) return stop("团队输出不完整，未交付新结果。", "failed", false);
        if (code !== 0 || !candidateResult) return stop("团队进程未正常完成，已保留完整代码。");
        team.outcome = team.review?.issues.length ? "issues" : "passed"; team.codeHash = generatedHash; team.durationMs = Date.now() - started;
        record("review-scope", "代码审查完成", "completed", "已保留静态审查意见；预览资格独立判断，未执行业务运行验证。");
        record("team", "TeamLeader 确认交付", "completed", `${team.calls.length} 次实际请求，总耗时 ${team.durationMs} ms。`);
        send({ type: "result", protocol: TEAM_PROTOCOL, taskId, team, assistantReply: candidateResult.assistantReply, result: { html: candidateResult.html, model: team.calls.filter(c => c.responseModel).at(-1)?.responseModel ?? "deepseek-flash", durationMs: team.durationMs, generatedAt: new Date().toISOString() } });
        terminal = true; cleanup(); controller.close();
      });
      if (request.signal.aborted) abort();
    },
    cancel() { cancelled = true; stop("任务连接已取消。", "stopped"); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
import { StringDecoder } from "node:string_decoder";
