export type RecordDetail = { label: string; content: string };
export type ExecutionStep = {
  label: string;
  status: string;
  statusText: string;
  detail: string;
  times: { status: string; at: string }[];
};

// Display only: source history never confers task identity or adoption authority.
export function GenerationRecordBody({ reply, pending = false, note, statuses = [], reviewSummary, issues = [], repairs = [], details = [], steps, taskId, source = false, resultLabel, resultHint }: {
  reply: string | null;
  pending?: boolean;
  note: string;
  statuses?: string[];
  reviewSummary?: string;
  issues?: string[];
  repairs?: { label: string; text: string }[];
  details?: RecordDetail[];
  steps: ExecutionStep[];
  taskId: string;
  source?: boolean;
  resultLabel?: string;
  resultHint?: string;
}) {
  return <>
    {pending ? <p className="record-note" role="status">等待模型完整说明…</p> : <p className="assistant-reply">{reply ?? "本次未取得助手说明"}</p>}
    <p className="record-note">{note}</p>
    {(statuses.length > 0 || details.length > 0) && <div className="team-deliveries">
      {statuses.map((status, i) => <p role={source ? undefined : "status"} key={i}>{status}</p>)}
      {repairs.map((repair, i) => <div key={i}><strong>{repair.label}</strong><p>{repair.text}</p></div>)}
      {reviewSummary && <div className="review-summary"><p>{reviewSummary}</p>{issues.length > 0 && <ul>{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}</div>}
      {details.map((detail, i) => <details key={i}><summary>{detail.label}</summary><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{detail.content}</pre></details>)}
    </div>}
    <div className="execution-card">
      <h3>平台执行记录 {pending && <span className="spinner" aria-label="进行中" />}</h3>
      <p className="record-note">结构检查和预览载入不代表业务功能已验证。</p>
      <ol>{steps.map((step, i) => <li key={i} data-status={step.status}><details>
        <summary><span>{step.label}</span><small>{step.statusText}</small></summary>
        <p>{step.detail}</p>
        {step.times.map((time, j) => <p className="event-time" key={j}>{time.status} · <time dateTime={time.at}>{time.at}</time></p>)}
      </details></li>)}</ol>
      <details className="record-note"><summary>任务归属与时间说明</summary><p>{source ? "来源任务" : "对应任务"}：{taskId}</p><p>各执行方记录自己的时间；列表按收到事件的先后排列，跨端时钟不用于推断耗时。{source ? "以上是制作示例前的历史记录，本次打开没有执行这些任务。" : "重开不会重新调用模型或补造缺失的记录。"}</p></details>
    </div>
    {resultLabel && <div className="result-card"><strong>{resultLabel}</strong><p>{resultHint ?? "请在右侧预览中实际操作，确认应用符合需求。"}</p></div>}
  </>;
}
