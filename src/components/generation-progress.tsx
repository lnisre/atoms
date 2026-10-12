"use client";

import { useEffect, useState } from "react";
import type { WorkbenchState } from "@/lib/cloud-projects/workbench";
import { generationFacts, generationStages } from "@/lib/generation-progress";
import { TEAM_TIMEOUT_MS } from "@/lib/team/contract";

export function GenerationProgressSummary({ state }: { state: WorkbenchState }) {
  const progress = state.progress!;
  const [now, setNow] = useState(progress.startedAt);
  const running = progress.endedAt === undefined;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const facts = generationFacts(progress);
  const elapsed = Math.max(0, Math.floor(((progress.endedAt ?? now) - progress.startedAt) / 1000));
  const quiet = Math.max(0, Math.floor((now - progress.lastProgressAt) / 1000));
  const connecting = running && progress.waiting !== "team";
  const failed = progress.outcome && !["passed", "issues"].includes(progress.outcome);
  const end = progress.outcome === "stopped" ? "任务已停止" : progress.outcome === "limit" ? "任务已达到执行上限" : progress.outcome === "clarification" ? "需要补充需求 · 本轮已结束" : progress.outcome === "unsupported" ? "暂不支持此需求 · 本轮已结束" : failed ? "执行失败" : "生成已结束";
  let status: string;
  if (running) status = progress.waiting === "trial" ? "正在准备试用副本 · 读取原项目数据" : connecting ? "正在建立生成连接" : facts.repairing ? `正在修复审查发现的问题 · 第 ${facts.repair} 次／最多 2 次` : `${generationStages[facts.stage]}${facts.coordinating ? " · 正在协调下一步" : facts.actor ? " · 进行中" : " · 等待下一步"}`;
  else if (!progress.html) status = end;
  else if (state.saving) status = "准备预览 · 正在保存项目，等待云端确认";
  else if (state.pending) status = "项目保存尚未确认 · 成果保留在当前页面";
  else if (progress.preview === "blocked") status = "执行阻断 · 此代码暂不执行";
  else if (progress.preview === "failed") status = "预览加载或运行失败 · 请查看预览中的原因";
  else if (progress.preview !== "loaded") status = "准备预览 · 正在加载隔离预览";
  else if (progress.modification && state.artifact?.taskId === progress.record.taskId) status = "可试用，未采用";
  else if (!progress.saved) status = "预览已加载 · 尚未确认云端保存";
  else status = state.cloud?.project.previewPolicy?.dataMode === "trial" ? "代码已保存 · 可副本试用，尚未启用" : "代码已保存 · 预览已加载";
  const next = !running ? undefined : connecting ? "连接就绪后整理需求，再编写应用、代码审查、准备预览。" : facts.repairing ? "修复完成后需要复审，再准备预览。" : facts.stage === 1 ? "代码交付并校验后进行代码审查，再准备预览。" : facts.stage === 2 ? "审查后准备预览；发现重大问题可能整体返工。" : facts.stage === 0 ? "需求确认后编写应用、代码审查、准备预览。" : "等待保存和预览加载结果。";
  return <section className="generation-progress" aria-label="生成进度">
    <div className="generation-progress-heading"><h2>生成进度</h2><span aria-live="off">{running ? "已用时" : "生成耗时"} {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒</span></div>
    <p className="generation-progress-status" role="status">{status}</p>
    <ol aria-label="生成阶段">{generationStages.map((label, index) => {
      const done = facts.completed[index] && (index !== 3 || (!state.pending && !state.saving));
      const active = !connecting && (running ? facts.stage === index : !!progress.html && index === 3 && (state.saving || progress.preview === "loading"));
      const text = done ? "已完成" : active ? "进行中" : running ? "待完成" : "未完成";
      return <li key={label} data-state={done ? "done" : active ? "active" : "pending"}><span aria-hidden="true">{done ? "✓" : active ? "●" : "○"}</span> {label}<small>{text}</small></li>;
    })}</ol>
    {next && <p>后续：{next}</p>}
    {!!facts.repair && !facts.repairing && <p>已进行 {facts.repair} 次整体返工／最多 2 次{facts.completed[2] ? " · 当前代码已审查" : " · 新代码仍需复审"}</p>}
    {running && facts.modelWaiting && quiet >= 30 && <p className="generation-long-wait" aria-live="off">仍在等待模型响应，最近一次进展在 {quiet} 秒前</p>}
    {running && <p className="generation-progress-limit">执行上限 {TEAM_TIMEOUT_MS / 60_000} 分钟 · 非完成承诺，请保持页面打开。</p>}
    {!running && failed && progress.html && <p>{end}{progress.reason ? `：${progress.reason}` : ""}</p>}
    {!running && !progress.html && <p>{progress.outcome === "stopped" ? "本轮未交付新代码。已有需求、记录和此前版本仍保留。" : progress.reason ?? "本轮未交付完整代码；已有成果保持不变。"}</p>}
    {!running && progress.html && progress.preview === "loaded" && !state.pending && <p>预览加载不代表业务验证通过{progress.record.team?.review && !progress.record.team.review.approved ? "；代码审查仍有待修复问题。" : "，请实际操作检查。"}</p>}
  </section>;
}
