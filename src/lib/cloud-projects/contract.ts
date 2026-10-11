import type { SavedProject } from "../project-store";

export type ProjectSummary = Pick<SavedProject, "id" | "title" | "updatedAt" | "exampleSource">;
export type ProjectVersion = { code: number; data: number };
export type CloudProject = {
  project: SavedProject;
  version: ProjectVersion;
  state: unknown;
  hasData: boolean;
};
export type HistoryEntry = {
  id: string; sequence: number; origin: "baseline" | "initial" | "example" | "activated" | "adopted";
  recordId: string | null; summary: string; pairedAt: string; dataSavedAt: string | null;
  hasData: boolean; nextSequence: number | null; status: "current" | "available" | "cleared";
};
export type ProjectHistory = { projectId: string; version: ProjectVersion; currentId: string | null; entries: HistoryEntry[] };
export type HistorySnapshot = { projectId: string; entry: HistoryEntry; project: SavedProject; state: unknown; hasData: boolean };
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
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const uuid = (value: unknown) => typeof value === "string" && UUID.test(value);
function validHistoryEntry(value: unknown) {
  return object(value) && uuid(value.id) && positive(value.sequence)
    && ["baseline", "initial", "example", "activated", "adopted"].includes(String(value.origin))
    && (value.recordId === null || typeof value.recordId === "string") && typeof value.summary === "string"
    && date(value.pairedAt) && (value.dataSavedAt === null || date(value.dataSavedAt)) && typeof value.hasData === "boolean"
    && (value.nextSequence === null || positive(value.nextSequence)) && ["current", "available", "cleared"].includes(String(value.status));
}
function validProject(value: unknown) {
  return validSummary(value) && object(value) && typeof value.requirement === "string" && object(value.result) && typeof value.result.html === "string";
}
export function validateCloudValue(kind: "list" | "project" | "data" | "receipt" | "history" | "snapshot", value: unknown) {
  let valid = false;
  if (kind === "list") valid = Array.isArray(value) && value.every(validSummary);
  else if (object(value)) {
    if (kind === "history") valid = uuid(value.projectId) && validVersion(value.version) && (value.currentId === null || uuid(value.currentId))
      && Array.isArray(value.entries) && value.entries.every(validHistoryEntry)
      && new Set(value.entries.map(e => e.id)).size === value.entries.length
      && value.entries.filter(e => e.status === "current").length === (value.currentId === null ? 0 : 1)
      && value.entries.every(e => (e.status === "current") === (e.id === value.currentId));
    else if (kind === "snapshot") valid = uuid(value.projectId) && validHistoryEntry(value.entry) && validProject(value.project)
      && object(value.project) && value.project.id === value.projectId && typeof value.hasData === "boolean" && Object.hasOwn(value, "state")
      && object(value.entry) && value.entry.hasData === value.hasData && value.entry.status !== "cleared";
    else if (kind === "receipt") valid = typeof value.projectId === "string" && UUID.test(value.projectId) && validVersion(value.version) && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt));
    else {
      valid = validVersion(value.version) && typeof value.hasData === "boolean" && Object.hasOwn(value, "state");
      if (kind === "project") {
        const project = value.project;
        valid = valid && validProject(project);
      }
    }
  }
  if (!valid) throw new ProjectError("invalid_response", "云端返回内容不完整，未确认读取或保存。请保留页面后重试。");
}
