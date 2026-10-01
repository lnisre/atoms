import { MAX_CONTEXT_LENGTH, MAX_HTML_LENGTH, MAX_REQUIREMENT_LENGTH } from "../generation";
import { previewHeadOffset } from "../html-document";

export type TeamInput = { projectId: string; requirement: string; modification?: string; baseHtml?: string; context?: string[] };
// Validate before signing and again before spawning. Only code and requirements
// cross the model boundary; browser business data is never an accepted field.
export function validTeamInput(value: unknown): value is TeamInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !["projectId", "requirement", "modification", "baseHtml", "context"].includes(k)) ||
      typeof b.projectId !== "string" || !/^[a-f0-9-]{36}$/.test(b.projectId) ||
      typeof b.requirement !== "string" || !b.requirement.trim() || b.requirement.length > MAX_REQUIREMENT_LENGTH) return false;
  if (!["modification", "baseHtml", "context"].some(k => k in b)) return true;
  return typeof b.modification === "string" && !!b.modification.trim() && b.modification.length <= MAX_REQUIREMENT_LENGTH &&
    typeof b.baseHtml === "string" && b.baseHtml.length <= MAX_HTML_LENGTH && previewHeadOffset(b.baseHtml) !== null &&
    Array.isArray(b.context) && b.context.every(item => typeof item === "string") && JSON.stringify(b.context).length <= MAX_CONTEXT_LENGTH;
}
