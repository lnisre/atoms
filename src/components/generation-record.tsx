import { AssistantMessage } from "./assistant-message";
import { issueText } from "@/lib/team/review";
import { outcomeLabels } from "@/lib/team/contract";
import type { InitialGeneration } from "@/lib/execution";
import { GenerationRecordBody, type RecordDetail } from "./generation-record-body";

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
  const team = record.team;
  const details: RecordDetail[] = team ? team.deliveries.map((delivery, i) => ({
    label: {Mike: "TeamLeader · 分派与交付", Requirements: "需求负责人 · 规格", Engineer: "实现工程师 · 交付", Reviewer: "Reviewer · 代码审查", Verifier: "验证工程师 · 检查"}[delivery.role] + (delivery.role === "Engineer" && team.deliveries.slice(0,i).some(d => d.role === "Engineer") ? ` · 第 ${team.deliveries.slice(0,i).filter(d=>d.role === "Engineer").length} 次整体返工` : delivery.role === "Reviewer" && team.deliveries.slice(0,i).some(d => d.role === "Reviewer") ? " · 新代码复审" : ""),
    content: delivery.content,
  })) : [];
  if (team?.check) details.push({label: "完整运行检查结果", content: JSON.stringify(team.check, null, 2)});
  if (team) details.push({label: `模型调用与用量 · ${team.calls.length} 次`, content: JSON.stringify(team.calls, null, 2)});
  const statuses = team ? [
    ...(team.outcome ? [outcomeLabels[team.outcome]] : []),
    team.review ? `代码审查：${team.review.approved ? "通过" : team.protocol === "atoms-team/3" ? "有待修复问题" : "未通过"} · 业务运行尚未验证` : team.check ? `浏览器检查：${team.check.status} · ${team.check.results.filter(r => r.status === "passed").length}/${team.check.results.length}` : pending ? "团队正在分派、实现或审查" : "本次未取得完整审查结果",
  ] : [];
  return <AssistantMessage title={title} requirement={requirement}>
    <GenerationRecordBody reply={record.assistantReply} pending={pending}
      note={team ? (team.protocol !== "atoms-team/1" ? "四角色代码审查流程；审查结论不代表业务运行已验证。" : "历史 QA 流程；检查结论仅覆盖当次代码、操作和合成样本。") : "M4 单模型生成；未执行四角色业务 QA。"}
      statuses={statuses} reviewSummary={team?.review?.summary} issues={team?.review?.issues.map(issueText)} repairs={repairs} details={details}
      steps={[...steps.values()].map(events => {
        const last = events.at(-1)!;
        return {label:last.label, status:last.status,
          statusText:last.status === "completed" ? "完成" : last.status === "failed" ? "失败" : team?.outcome && last.stepId.startsWith("model-") ? "执行已结束，未取得结果" : live ? "进行中" : "未记录结束状态",
          detail:`${last.source === "server" ? "服务端" : "浏览器"}执行 · ${last.detail}`,
          times:events.map(event => ({status:event.status === "started" ? "开始" : event.status === "completed" ? "完成" : "失败", at:event.at})),
        };
      })} taskId={record.taskId} resultLabel={resultLabel} resultHint={resultHint} />
    {saving && <p className="record-note" role="status">执行记录正在保存，请等待完成再离开。</p>}
    {saveError && <p className="save-error" role="alert">执行记录保存失败，最新步骤可能无法恢复；已保存的应用和业务数据仍保留。请保留页面。</p>}
  </AssistantMessage>;
}
