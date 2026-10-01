import schema from "../../../runtime/team/review.schema.json";
import type { Delivery, TeamRecord } from "./contract";
export type CodeReview = { kind: "code-review"; codeHash: string; taskId?: string; approved: boolean; summary: string; issues: string[] };
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= schema.properties.summary.maxLength;
export function validReview(value: unknown, codeHash: string): value is CodeReview {
  if (!value || typeof value !== "object") return false;
  const r = value as CodeReview;
  return r.kind === "code-review" && /^[a-f0-9]{64}$/.test(codeHash) && r.codeHash === codeHash &&
    typeof r.approved === "boolean" && text(r.summary) && Array.isArray(r.issues) &&
    r.issues.length <= schema.properties.issues.maxItems && r.issues.every(text) && r.approved === (r.issues.length === 0) &&
    Object.keys(r).every(k => ["kind", "codeHash", "taskId", ...schema.required].includes(k));
}
// Replay actual handoffs, so a stale approval or missing repair/re-review cannot
// be hidden by replacing only the final review field. Historical saved records
// are displayed as-is; only new deliveries must satisfy this execution gate.
export function inspectDeliveries(taskId: string, deliveries: Delivery[]) {
  let spec = false, codeHash: string | undefined, review: CodeReview | undefined;
  let iterations = 0, expected: string | undefined, finished = false, aborted = false;
  for (const delivery of deliveries) {
    if (finished) throw new Error("交付终态后出现新角色产物");
    const value = JSON.parse(delivery.content);
    if (delivery.role === "Mike") {
      if (expected) throw new Error("已分派角色尚未交付");
      if (value.command === "assign") {
        const target = value.to;
        if (target === "Requirements" ? spec || !!codeHash : target === "Engineer" ? !spec || iterations >= 2 || (!!codeHash && (!review || review.approved)) : target === "Reviewer" ? !codeHash || !!review : true) throw new Error("Leader 分派违反一次返工与产物依赖");
        expected = target;
      } else if (value.command === "finish") {
        if (!review?.approved || review.codeHash !== codeHash) throw new Error("Leader 缺少当前代码批准");
        finished = true;
      } else if (value.command === "abort") { finished = true; aborted = true; }
      else throw new Error("Leader 决定无效");
    } else {
      if (expected !== delivery.role) throw new Error("角色未由 Leader 实际分派");
      expected = undefined;
      if (delivery.role === "Requirements") {
        if (spec || !Array.isArray(value.requirements) || !value.requirements.length) throw new Error("缺少冻结规格");
        spec = true;
      } else if (delivery.role === "Engineer") {
        if (!/^[a-f0-9]{64}$/.test(value.codeHash) || value.codeHash === codeHash) throw new Error("返工缺少新代码");
        codeHash = value.codeHash; review = undefined; iterations++;
      } else if (delivery.role === "Reviewer") {
        if (!codeHash || !validReview(value, codeHash) || value.taskId !== taskId) throw new Error("审查与任务或当前代码不符");
        review = value;
      } else throw new Error("非代码审查角色不能批准新任务");
    }
  }
  return { codeHash, review, iterations, finished, aborted };
}
export function reviewedTeam(team: TeamRecord, codeHash: string): boolean {
  try {
    if (!Array.isArray(team.calls) || team.calls.length > 20 || team.calls.some((c, i) => c.call !== i+1 || !["completed", "failed"].includes(c.status)) || (team.outcome && team.outcome !== "passed") || !Array.isArray(team.deliveries) || team.protocol !== "atoms-team/2" || team.codeHash !== codeHash || !validReview(team.review, codeHash) || !team.review.approved || team.review.taskId !== team.taskId) return false;
    const state = inspectDeliveries(team.taskId, team.deliveries);
    return state.finished && !state.aborted && state.codeHash === codeHash && JSON.stringify(state.review) === JSON.stringify(team.review) &&
      ["Mike", "Requirements", "Engineer", "Reviewer"].every(role => team.calls.filter(c => c.actor === role && c.status === "completed").length >= team.deliveries.filter(d => d.role === role).length);
  } catch { return false; }
}
