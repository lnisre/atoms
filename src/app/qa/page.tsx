"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { runQualificationTask } from "@/lib/qa/task";
import type { CheckResult, ToolRequest, ToolResult } from "@/lib/qa/contract";
import type { ExecutionEvent } from "@/lib/execution";

const subscribeReady = () => () => {};
const browserReady = () => true;
const serverReady = () => false;

export default function QaPage() {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const [fixture, setFixture] = useState("todo");
  const [variant, setVariant] = useState("normal");
  const ready = useSyncExternalStore(subscribeReady, browserReady, serverReady);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("尚未执行");
  const [request, setRequest] = useState<ToolRequest | null>(null);
  const [rows, setRows] = useState<CheckResult[]>([]);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  useEffect(() => {
    const stop = () => active.current?.abort();
    window.addEventListener("pagehide", stop);
    return () => { stop(); window.removeEventListener("pagehide", stop); };
  }, []);
  async function run() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setRunning(true); setStatus("正在执行"); setRows([]); setEvents([]); setResult(null); setRequest(null);
    const current = () => active.current === controller;
    try {
      const completion = await runQualificationTask(fixture, variant, host.current!, controller.signal,
        r => { if (current()) setRequest(r); }, r => { if (current()) setRows(rows => [...rows, r]); },
        e => { if (current()) setEvents(events => [...events, e]); }, r => { if (current()) { setResult(r); setRows(r.results); } });
      if (current()) setStatus(`${completion.status} · ${completion.detail}`);
    } catch (e) {
      if (current()) setStatus(controller.signal.aborted ? "cancelled · 用户已停止，未执行项不计通过。" : `tool-error · ${e instanceof Error ? e.message : String(e)}`);
    } finally { if (current()) { setRunning(false); active.current = null; } }
  }
  return <main style={{ maxWidth: 1100, margin: "40px auto", padding: 24, color: "#202124", background: "white", minHeight: "90vh" }}>
    <Link href="/">返回 Atoms</Link>
    <h1 style={{ fontSize: 28, marginTop: 24 }}>QA 工具资格验证</h1>
    <p>确定性任务与手写 HTML，零模型调用。检查在独立页面使用合成数据；不是四角色生成或正式应用交付。</p>
    <p>页内脚本操作不等同于 Playwright；结果只覆盖所列行为，不是对恶意代码的安全证明。</p>
    <div style={{ display: "flex", gap: 16, margin: "24px 0" }}>
      <label>应用 <select aria-label="应用" value={fixture} disabled={running} onChange={e => setFixture(e.target.value)}><option value="todo">待办</option><option value="reading">阅读记录</option></select></label>
      <label>验证场景 <select aria-label="验证场景" value={variant} disabled={running} onChange={e => setVariant(e.target.value)}>
        <option value="normal">正常与读写失败注入</option><option value="read-bug">缺陷：读失败仍编辑并保存</option><option value="save-bug">缺陷：保存失败显示成功</option><option value="tamper">干扰：覆盖 DOM 方法与伪造窗口结果</option><option value="no-result">无执行器结果</option><option value="timeout">短时限超时</option><option value="slow">等待中停止</option>
      </select></label>
      <button disabled={!ready || running} onClick={run}>开始检查</button>
      <button disabled={!running} onClick={() => active.current?.abort()}>停止检查</button>
    </div>
    <p role="status" data-testid="qa-status">{status}</p>
    {request && <p style={{ overflowWrap: "anywhere" }}>任务 {request.taskId}<br />代码 SHA-256 {request.codeHash}<br />计划 SHA-256 {request.planHash}</p>}
    <div ref={host} aria-label="独立检查容器" />
    <ol>{events.map(e => <li key={`${e.source}-${e.sequence}`}>{e.label} · {e.status} · {e.detail}</li>)}</ol>
    <p>已通过 {rows.filter(r => r.status === "passed").length} / {request?.scenarios.reduce((n, s) => n + s.checks.length, 0) ?? 0} 项</p>
    <details><summary>实际操作、预期与结果</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-testid="qa-evidence">{JSON.stringify({ request, result }, null, 2)}</pre></details>
    <table style={{ width: "100%", textAlign: "left" }}><thead><tr><th>场景 / 项目</th><th>操作</th><th>结果</th><th>实际值</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.scenarioId}-${r.checkId}`}><td>{r.scenarioId} / {r.checkId}</td><td>{r.command.op}</td><td>{r.status}</td><td style={{ maxWidth: 300, overflowWrap: "anywhere" }}>{JSON.stringify(r.actual)}</td></tr>)}</tbody></table>
  </main>;
}
