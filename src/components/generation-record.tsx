import type { InitialGeneration } from "@/lib/execution";

export function GenerationRecord({ record, live, pending, saveError, saving, title = "首次生成", requirement, resultLabel }: { title?: string; requirement?: string; resultLabel?: string; record: InitialGeneration; live: boolean; pending: boolean; saveError: boolean; saving: boolean }) {
  const steps = new Map<string, typeof record.events>();
  for (const event of record.events) {
    const key = `${event.source}:${event.stepId}`;
    steps.set(key, [...(steps.get(key) ?? []), event]);
  }
  return <section className="generation-record" aria-label={`${title}记录`}>
    {requirement && <div className="user-message"><span>你</span><p>{requirement}</p></div>}
    <div className="assistant-heading"><span className="assistant-mark" aria-hidden="true">✳</span><h2>助手 <span>{title}</span></h2></div>
    <div className="assistant-content">
      {pending ? <p className="record-note" role="status">等待模型完整说明…</p> : <p className="assistant-reply">{record.assistantReply ?? "本次未取得助手说明"}</p>}
      <p className="record-note">模型说明仅供参考，实际执行情况见下方记录。</p>
      <div className="execution-card">
        <h3>平台执行记录 {pending && <span className="spinner" aria-label="进行中" />}</h3>
        <p className="record-note">结构检查和预览载入不代表业务功能已验证。</p>
        <ol>{[...steps.entries()].map(([key, events]) => {
          const last = events.at(-1)!;
          const status = last.status === "completed" ? "完成" : last.status === "failed" ? "失败" : live ? "进行中" : "未记录结束状态";
          return <li key={key} data-status={last.status}><details>
            <summary><span>{last.label}</span><small>{status}</small></summary>
            <p>{last.source === "server" ? "服务端" : "浏览器"}执行 · {last.detail}</p>
            {events.map(event => <p className="event-time" key={event.sequence}>{event.status === "started" ? "开始" : event.status === "completed" ? "完成" : "失败"} · <time dateTime={event.at}>{event.at}</time></p>)}
          </details></li>;
        })}</ol>
        <details className="record-note"><summary>任务归属与时间说明</summary><p>对应任务：{record.taskId}</p><p>各执行方记录自己的时间；列表按收到事件的先后排列，跨端时钟不用于推断耗时。重开不会重新调用模型或补造缺失的记录。</p></details>
      </div>
      {resultLabel && <div className="result-card"><strong>{resultLabel}</strong><p>请在右侧预览中实际操作，确认应用符合需求。</p></div>}
      {saving && <p className="record-note" role="status">执行记录正在保存，请等待完成再离开。</p>}
      {saveError && <p className="save-error" role="alert">执行记录保存失败，最新步骤可能无法恢复；已保存的应用和业务数据仍保留。请保留页面。</p>}
    </div>
  </section>;
}
