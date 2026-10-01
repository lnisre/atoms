import schema from "../../../runtime/team/review.schema.json";
import type { TeamRecord } from "./contract";
export type CodeReview = { kind: "code-review"; codeHash: string; approved: boolean; summary: string; issues: string[] };
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= schema.properties.summary.maxLength;
export function validReview(value: unknown, codeHash: string): value is CodeReview {
  if (!value || typeof value !== "object") return false;
  const r = value as CodeReview;
  return r.kind === "code-review" && /^[a-f0-9]{64}$/.test(codeHash) && r.codeHash === codeHash &&
    typeof r.approved === "boolean" && text(r.summary) && Array.isArray(r.issues) &&
    r.issues.length <= schema.properties.issues.maxItems && r.issues.every(text) && r.approved === (r.issues.length === 0) &&
    Object.keys(r).every(k => ["kind", "codeHash", ...schema.required].includes(k));
}
export function reviewedTeam(team: TeamRecord, codeHash: string): boolean {
  return Array.isArray(team.calls) && Array.isArray(team.deliveries) && team.protocol === "atoms-team/2" && team.codeHash === codeHash && validReview(team.review, codeHash) && team.review.approved &&
    ["Mike", "Requirements", "Engineer", "Reviewer"].every(role =>
      team.calls.some(c => c.actor === role && c.status === "completed") && team.deliveries.some(d => d.role === role));
}
