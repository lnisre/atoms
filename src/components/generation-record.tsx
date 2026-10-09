import { AssistantMessage } from "./assistant-message";
import { issueText } from "@/lib/team/review";
import { outcomeLabels } from "@/lib/team/contract";
import type { InitialGeneration } from "@/lib/execution";

export function GenerationRecord({ record, live, pending, saveError, saving, title = "首次生成", requirement, resultLabel, resultHint }: { title?: string; requirement?: string; resultLabel?: string; resultHint?: string; record: InitialGeneration; live: boolean; pending: boolean; saveError: boolean; saving: boolean }) {
  const repairs = (record.team?.deliveries ?? []).flatMap((delivery, i, deliveries) => {
    try {
      const value = JSON.parse(delivery.content);
      if (delivery.role === "Mike" && value.command === "assign" && value.to === "Engineer" && deliveries.slice(0,i).some(d => d.role === "Reviewer")) return [{label:`TeamLeader · 第 ${deliveries.slice(0,i).filter(d=>d.role === "Engineer").length} 次整体返工`, text:value.reason}];
      if (delivery.role === "Engineer" && deliveries.slice(0,i).some(d => d.role === "Engineer")) return [{label:"Engineer · 修改说明", text:value.assistantReply}];
    } catch { /* Historical delivery text remains available in details. */ }
    return [];
  });
  const steps = new Map<string, typeof record.events>();
  for (const event of record.events) {
    const key = `${event.source}:${event.stepId}`;
    steps.set(key, [...(steps.get(key) ?? []), event]);
  }
  return <AssistantMessage title={title} requirement={requirement}>
      {pending ? <p className="record-note" role="status">等待模型完整说明…</p> : <p className="assistant-reply">{record.assistantReply ?? "本次未取得助手说明"}</p>}
      <p className="record-note">{record.team ? (record.team.protocol !== "atoms-team/1" ? "四角色代码审查流程；审查结论不代表业务运行已验证。" : "历史 QA 流程；检查结论仅覆盖当次代码、操作和合成样本。") : "M4 单模型生成；未执行四角色业务 QA。"}</p>
      {record.team && <div className="team-deliveries">
        {record.team.outcome && <p role="status">{outcomeLabels[record.team.outcome]}</p>}
        <p role="status">{record.team.review ? `代码审查：${record.team.review.approved ? "通过" : record.team.protocol === "atoms-team/3" ? "有待修复问题" : "未通过"} · 业务运行尚未验证` : record.team.check ? `浏览器检查：${record.team.check.status} · ${record.team.check.results.filter(r => r.status === "passed").length}/${record.team.check.results.length}` : pending ? "团队正在分派、实现或审查" : "本次未取得完整审查结果"}</p>
        {repairs.map((repair, i) => <div key={i}><strong>{repair.label}</strong><p>{repair.text}</p></div>)}
        {record.team.review && <div className="review-summary"><p>{record.team.review.summary}</p>{record.team.review.issues.length > 0 && <ul>{record.team.review.issues.map((issue, i) => <li key={i}>{issueText(issue)}</li>)}</ul>}</div>}
        {record.team.deliveries.map((delivery, i) => <details key={i}><summary>{{Mike: "TeamLeader · 分派与交付", Requirements: "需求负责人 · 规格", Engineer: "实现工程师 · 交付", Reviewer: "Reviewer · 代码审查", Verifier: "验证工程师 · 检查"}[delivery.role]}{delivery.role === "Engineer" && record.team!.deliveries.slice(0,i).some(d => d.role === "Engineer") ? ` · 第 ${record.team!.deliveries.slice(0,i).filter(d=>d.role === "Engineer").length} 次整体返工` : delivery.role === "Reviewer" && record.team!.deliveries.slice(0,i).some(d => d.role === "Reviewer") ? " · 新代码复审" : ""}</summary><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{delivery.content}</pre></details>)}
        {record.team.check && <details><summary>完整运行检查结果</summary><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{JSON.stringify(record.team.check, null, 2)}</pre></details>}
        <details><summary>模型调用与用量 · {record.team.calls.length} 次</summary><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{JSON.stringify(record.team.calls, null, 2)}</pre></details>
      </div>}
      <div className="execution-card">
        <h3>平台执行记录 {pending && <span className="spinner" aria-label="进行中" />}</h3>
        <p className="record-note">结构检查和预览载入不代表业务功能已验证。</p>
        <ol>{[...steps.entries()].map(([key, events]) => {
          const last = events.at(-1)!;
          const status = last.status === "completed" ? "完成" : last.status === "failed" ? "失败" : record.team?.outcome && last.stepId.startsWith("model-") ? "执行已结束，未取得结果" : live ? "进行中" : "未记录结束状态";
          return <li key={key} data-status={last.status}><details>
            <summary><span>{last.label}</span><small>{status}</small></summary>
            <p>{last.source === "server" ? "服务端" : "浏览器"}执行 · {last.detail}</p>
            {events.map(event => <p className="event-time" key={event.sequence}>{event.status === "started" ? "开始" : event.status === "completed" ? "完成" : "失败"} · <time dateTime={event.at}>{event.at}</time></p>)}
          </details></li>;
        })}</ol>
        <details className="record-note"><summary>任务归属与时间说明</summary><p>对应任务：{record.taskId}</p><p>各执行方记录自己的时间；列表按收到事件的先后排列，跨端时钟不用于推断耗时。重开不会重新调用模型或补造缺失的记录。</p></details>
      </div>
      {resultLabel && <div className="result-card"><strong>{resultLabel}</strong><p>{resultHint ?? "请在右侧预览中实际操作，确认应用符合需求。"}</p></div>}
      {saving && <p className="record-note" role="status">执行记录正在保存，请等待完成再离开。</p>}
      {saveError && <p className="save-error" role="alert">执行记录保存失败，最新步骤可能无法恢复；已保存的应用和业务数据仍保留。请保留页面。</p>}
  </AssistantMessage>;
}
