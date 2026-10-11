import type { SavedProject } from "../project-store";

export type ProjectSummary = Pick<SavedProject, "id" | "title" | "updatedAt" | "exampleSource">;
export type ProjectVersion = { code: number; data: number };
export type CloudProject = {
  project: SavedProject;
  version: ProjectVersion;
  state: unknown;
  hasData: boolean;
};
export type DataSnapshot = { state: unknown; hasData: boolean; version: ProjectVersion };
export type CommitReceipt = { projectId: string; version: ProjectVersion; updatedAt: string };
export type DataSave = { operationId: string; expected: ProjectVersion; state: unknown };
export class ProjectError extends Error {
  constructor(public code: string, message: string, public status = 503) { super(message); }
}
export const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const MAX_STATE_BYTES = 1_000_000;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validVersion(value: unknown) {
  return object(value) && [value.code, value.data].every(v => typeof v === "number" && Number.isSafeInteger(v) && v > 0);
}
function validSummary(value: unknown) {
  return object(value) && typeof value.id === "string" && UUID.test(value.id) && typeof value.title === "string" && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
}
export function validateCloudValue(kind: "list" | "project" | "data" | "receipt", value: unknown) {
  let valid = false;
  if (kind === "list") valid = Array.isArray(value) && value.every(validSummary);
  else if (object(value)) {
    if (kind === "receipt") valid = typeof value.projectId === "string" && UUID.test(value.projectId) && validVersion(value.version) && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
    else {
      valid = validVersion(value.version) && typeof value.hasData === "boolean" && Object.hasOwn(value, "state");
      if (kind === "project") {
        const project = value.project;
        valid = valid && validSummary(project) && object(project) && typeof project.requirement === "string" && object(project.result) && typeof project.result.html === "string";
      }
    }
  }
  if (!valid) throw new ProjectError("invalid_response", "云端返回内容不完整，未确认读取或保存。请保留页面后重试。");
}
