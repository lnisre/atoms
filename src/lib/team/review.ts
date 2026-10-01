import type { Delivery, TeamRecord } from "./contract";
import { inspectLegacyDeliveries, legacyReviewedTeam, validLegacyReview, type LegacyCodeReview } from "./legacy-review";
export { legacyReviewedTeam };
export type ReviewIssue = { id: string; severity: "major" | "minor"; category: "functionality" | "data-loss" | "persistence" | "interaction"; codeQuote: string; trigger: string; consequence: string };
export type ClassifiedReview = { kind: "code-review"; schemaVersion: 1; codeHash: string; taskId: string; approved: boolean; summary: string; issues: ReviewIssue[]; resolutions: { id: string; codeQuote: string; explanation: string }[] };
export type CodeReview = LegacyCodeReview | ClassifiedReview;
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2000;
const id = (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9-]{0,50}$/.test(v);
export function validIssue(value: unknown): value is ReviewIssue {
  if (!value || typeof value !== "object") return false;
  const i = value as ReviewIssue;
  return Object.keys(i).length === 6 && id(i.id) && ["major","minor"].includes(i.severity) && ["functionality","data-loss","persistence","interaction"].includes(i.category) && text(i.codeQuote) && text(i.trigger) && text(i.consequence);
}
export function isClassified(review: CodeReview | undefined): review is ClassifiedReview { return !!review && "schemaVersion" in review && review.schemaVersion === 1; }
export function validClassifiedReview(value: unknown, codeHash: string, html?: string): value is ClassifiedReview {
  if (!value || typeof value !== "object") return false;
  const r = value as ClassifiedReview;
  return r.kind === "code-review" && r.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(codeHash) && r.codeHash === codeHash && typeof r.taskId === "string" && typeof r.approved === "boolean" && text(r.summary) &&
    Array.isArray(r.issues) && r.issues.length <= 20 && r.issues.every(validIssue) && new Set(r.issues.map(i=>i.id)).size === r.issues.length && r.approved === (r.issues.length === 0) &&
    Array.isArray(r.resolutions) && r.resolutions.length <= 20 && r.resolutions.every(v => v && Object.keys(v).length === 3 && id(v.id) && text(v.codeQuote) && text(v.explanation) && !r.issues.some(i=>i.id===v.id)) && new Set(r.resolutions.map(v=>v.id)).size === r.resolutions.length &&
    Object.keys(r).every(k => ["kind","schemaVersion","taskId","codeHash","approved","summary","issues","resolutions"].includes(k)) &&
    (html === undefined || [...r.issues,...r.resolutions].every(i=>html.includes(i.codeQuote)));
}
export const validReview = (value: unknown, codeHash: string): value is CodeReview => validClassifiedReview(value,codeHash) || validLegacyReview(value,codeHash);
export const reviewedTeam = legacyReviewedTeam; // Historical v2 gate, never used for v3 preview.
export function needsRepair(review: CodeReview | undefined) { return isClassified(review) ? review.issues.some(i=>i.severity === "major") : !!review && !review.approved; }
export const issueText = (issue: string | ReviewIssue) => typeof issue === "string" ? issue : `${issue.severity === "major" ? "重大" : "一般"} · ${issue.consequence}（${issue.trigger}；代码：${issue.codeQuote}）`;
export function inspectDeliveries(taskId: string, deliveries: Delivery[], protocol = "atoms-team/2") {
  if (protocol !== "atoms-team/3") return inspectLegacyDeliveries(taskId,deliveries);
  let spec = false, codeHash: string | undefined, review: ClassifiedReview | undefined;
  let iterations = 0, expected: string | undefined, finished = false, aborted = false;
  for (const delivery of deliveries) {
    if (finished) throw new Error("交付终态后出现新角色产物");
    const value = JSON.parse(delivery.content);
    if (delivery.role === "Mike") {
      if (expected) throw new Error("已分派角色尚未交付");
      if (value.command === "assign") {
        const target = value.to;
        if (target === "Requirements" ? spec || !!codeHash : target === "Engineer" ? !spec || iterations >= 3 || (!!codeHash && !needsRepair(review)) : target === "Reviewer" ? !codeHash || !!review : true) throw new Error("Leader 分派违反两次返工与产物依赖");
        expected = target;
      } else if (value.command === "finish") {
        if (!review || review.codeHash !== codeHash) throw new Error("Leader 缺少当前代码的审查结果");
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
        if (!/^[a-f0-9]{64}$/.test(value.codeHash) || value.codeHash === codeHash || value.iteration !== iterations+1) throw new Error("返工缺少新代码或轮次不符");
        codeHash = value.codeHash; review = undefined; iterations++;
      } else if (delivery.role === "Reviewer") {
        if (!codeHash || !validClassifiedReview(value,codeHash) || value.taskId !== taskId) throw new Error("审查与任务或当前代码不符");
        review = value;
      } else throw new Error("未知角色");
    }
  }
  return { codeHash, review, iterations, finished, aborted };
}
// Artifact availability is independent of model approval and execution success.
export function artifactTeam(team: TeamRecord, codeHash: string, terminal = false): boolean {
  try {
    if (team.protocol !== "atoms-team/3" || team.codeHash !== codeHash || !Array.isArray(team.calls) || team.calls.length > 20 || team.calls.some((c,i)=>c.call !== i+1 || !["started","completed","failed"].includes(c.status)) || !Array.isArray(team.deliveries)) return false;
    const state = inspectDeliveries(team.taskId,team.deliveries,team.protocol);
    if (state.codeHash !== codeHash || JSON.stringify(state.review) !== JSON.stringify(team.review)) return false;
    if (terminal && ["passed","issues"].includes(team.outcome ?? "") && (!state.finished || state.aborted)) return false;
    if (terminal && (!team.outcome || ["stopped","clarification","unsupported"].includes(team.outcome))) return false;
    return ["Mike","Requirements","Engineer","Reviewer"].every(role=>team.calls.filter(c=>c.actor===role && c.status === "completed").length >= team.deliveries.filter(d=>d.role===role).length);
  } catch { return false; }
}
export function unresolvedDataIssues(team: TeamRecord): ReviewIssue[] {
  const pending = new Map((team.baseDataIssues ?? []).map(i=>[i.id,i]));
  for (const d of team.deliveries) if (d.role === "Reviewer") {
    const r = JSON.parse(d.content) as CodeReview;
    if (isClassified(r)) {
      for (const i of r.issues) if (i.category === "data-loss" || i.category === "persistence") pending.set(i.id,i);
    }
  }
  // A resolution is evidence for one artifact, never a transferable approval.
  if (isClassified(team.review) && team.review.codeHash === team.codeHash) {
    for (const v of team.review.resolutions) pending.delete(v.id);
  }
  return [...pending.values()];
}
