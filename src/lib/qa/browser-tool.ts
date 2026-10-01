import { previewDocument } from "../preview-document";
import { previewHeadOffset } from "../html-document";
import { qaFrameScript } from "./frame-script";
import { equal, expected, sha256, validateRequest, type CheckResult, type Json, type ToolRequest, type ToolResult } from "./contract";

// Deliberately has no project-store, project ID, trial object, or storage adapter.
// Only an explicit synthetic seed enters this tool; each scenario gets a clone.
export async function runBrowserCheck(request: ToolRequest, host: HTMLElement, signal: AbortSignal, progress: (row: CheckResult) => void): Promise<ToolResult> {
  const results: CheckResult[] = [];
  const identity = { protocol: request.protocol, taskId: request.taskId, requestId: request.requestId, codeHash: request.codeHash, planHash: request.planHash };
  let status: ToolResult["status"] = "passed", detail = "所有计划项实际执行完成。";
  const alive = () => {
    if (signal.aborted) throw new Error("cancelled");
    if (Date.now() >= request.deadline) throw new Error("timeout");
  };
  try {
    alive();
    validateRequest(request);
    if (await sha256(request.html) !== request.codeHash || await sha256(JSON.stringify(request.scenarios)) !== request.planHash) throw new Error("code/plan identity mismatch");
    for (const scenario of request.scenarios) {
      alive();
      const frame = document.createElement("iframe");
      frame.title = `独立检查页面 · ${scenario.id}`;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.referrerPolicy = "no-referrer";
      frame.style.cssText = "width:100%;height:260px;border:1px solid #d4d4d4;pointer-events:none";
      const channel = crypto.randomUUID();
      let disposed = false, readSucceeded = false, sequence = 0;
      let state = structuredClone(scenario.seed);
      const stats = { saveAttempts: 0, rejectedSaves: 0, commits: 0 };
      let queue = Promise.resolve();
      let runtimeErrors = 0;
      let port: MessagePort | undefined;
      let readyResolve!: () => void;
      const ready = new Promise<void>(resolve => { readyResolve = resolve; });
      let pending: { sequence: number; resolve: (value: Json) => void; reject: (e: Error) => void } | undefined;
      const receive = (event: MessageEvent) => {
        const m = event.data;
        if (disposed || event.source !== frame.contentWindow || event.origin !== "null" || m?.channel !== channel) return;
        if (m.type === "atoms:qa-ready" && !port && event.ports.length === 1) {
          port = event.ports[0];
          port.onmessage = e => {
            if (disposed || signal.aborted || Date.now() >= request.deadline || !pending || e.data?.sequence !== pending.sequence) return;
            const p = pending; pending = undefined;
            if (e.data.ok === true) p.resolve(e.data.actual); else p.reject(new Error(String(e.data.error)));
          };
          readyResolve(); return;
        }
        if (m.type === "atoms:preview-error" || m.type === "atoms:storage-error") { runtimeErrors++; return; }
        if (m.type !== "atoms:state" || !Number.isSafeInteger(m.id) || !["load", "save"].includes(m.method)) return;
        if (m.method === "save") stats.saveAttempts++;
        // Capture read permission at arrival, not after a pending read finishes.
        const permitted = readSucceeded;
        queue = queue.then(async () => {
          if (disposed || signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, m.method === "load" ? scenario.loadDelayMs ?? 0 : scenario.saveDelayMs ?? 0));
          if (disposed || signal.aborted || Date.now() >= request.deadline) return;
          let error: string | undefined;
          if (m.method === "load") {
            if (scenario.fault === "read") error = "读取失败"; else readSucceeded = true;
          } else if (!permitted) { stats.rejectedSaves++; error = "未成功读取，已阻止覆盖保存"; }
          else if (scenario.fault === "save") { stats.rejectedSaves++; error = "保存失败"; }
          else {
            let json: string | undefined;
            try { json = JSON.stringify(m.state); } catch { /* reject non-JSON data below */ }
            if (json === undefined || json.length > 1_000_000) { stats.rejectedSaves++; error = "非法状态"; }
            else { state = JSON.parse(json); stats.commits++; }
          }
          frame.contentWindow?.postMessage({ type: "atoms:state-result", channel, id: m.id, ok: !error, error, state: m.method === "load" ? state : undefined }, "*");
        });
      };
      // Every wait is bounded and abortable, including missing ready/command results.
      const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const abort = () => finish(new Error("cancelled"));
        const timer = setTimeout(() => finish(new Error(Date.now() >= request.deadline ? "timeout" : "no-result")), Math.max(1, Math.min(3000, request.deadline - Date.now())));
        function finish(error?: Error, value?: T) { clearTimeout(timer); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(value as T); }
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        promise.then(v => finish(undefined, v), e => finish(e));
      });
      window.addEventListener("message", receive);
      try {
        const documentHtml = previewDocument(request.html, channel, location.origin);
        const offset = previewHeadOffset(documentHtml)!;
        // CSP remains first; the executor still precedes every application script.
        const endGuard = documentHtml.indexOf("</script>", offset) + "</script>".length;
        frame.srcdoc = documentHtml.slice(0, endGuard) + (scenario.fault === "no-result" ? "" : qaFrameScript(channel, location.origin)) + documentHtml.slice(endGuard);
        host.replaceChildren(frame);
        await bounded(ready);
        for (const check of scenario.checks) {
          alive();
          const startedAt = Date.now();
          const command = check.command;
          let actual: Json = null, rowStatus: CheckResult["status"] = "passed";
          try {
            if (command.op === "data") {
              let value: unknown = state;
              for (const key of command.path) value = value && typeof value === "object" && Object.hasOwn(value, key) ? Reflect.get(value, key) : null;
              actual = structuredClone(value) as Json;
            } else if (command.op === "bridge") actual = stats[command.property];
            else {
              actual = await bounded(new Promise<Json>((resolve, reject) => {
                pending = { sequence: ++sequence, resolve, reject };
                port!.postMessage({ sequence, command });
              }));
            }
            alive();
            if (command.op !== "observe" && !equal(expected(command), actual)) rowStatus = "failed";
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (["cancelled", "timeout", "no-result"].includes(message)) throw e;
            rowStatus = "tool-error"; actual = message;
          }
          const row: CheckResult = { scenarioId: scenario.id, checkId: check.id, command, expected: expected(command), actual, status: rowStatus, startedAt, endedAt: Date.now() };
          results.push(row); progress(row);
          if (rowStatus !== "passed") status = "failed";
        }
        if (runtimeErrors) { status = "failed"; detail = `${scenario.id}: 浏览器报告 ${runtimeErrors} 次运行或数据桥异常。`; }
      } finally {
        disposed = true;
        window.removeEventListener("message", receive);
        port?.close(); frame.remove();
      }
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
    status = detail === "cancelled" ? "cancelled" : detail === "timeout" ? "timeout" : "tool-error";
  }
  // Explicitly preserve every mandatory item that did not execute.
  for (const scenario of request.scenarios) for (const check of scenario.checks) {
    if (!results.some(r => r.scenarioId === scenario.id && r.checkId === check.id)) results.push({ scenarioId: scenario.id, checkId: check.id, command: check.command, expected: expected(check.command), actual: null, status: "not-run", startedAt: 0, endedAt: 0 });
  }
  if (status === "failed" && detail === "所有计划项实际执行完成。") detail = "实际检查存在失败；未交付应用。";
  return { ...identity, status, results, detail };
}
