import type { CodeReview } from "./review";
import type { ToolRequest, ToolResult, Scenario, Command, Json } from "../qa/contract";
export const TEAM_PROTOCOL = "atoms-team/2";
export const TEAM_TIMEOUT_MS = 240_000;
export type PlatformProbe = { seed: Json; prepare: Command[]; commitSelector: string; changed: { path: string[]; equals: Json } };
export type Specification = {
  summary: string;
  requirements: { id: string; description: string }[];
  dataContract?: string;
  probe?: PlatformProbe;
};
export type Delivery = { role: "Mike" | "Requirements" | "Engineer" | "Reviewer" | "Verifier"; content: string };
export type ModelCall = { call: number; actor: string; requestedModel: string; thinking?: "enabled" | "disabled"; reasoningEffort?: "none" | "low"; responseModel?: string; responseId?: string; usage?: Record<string, Json>; elapsedMs?: number; status: "started" | "completed" | "failed" };
export type TeamOutcome = "passed" | "rejected" | "failed" | "stopped" | "limit" | "clarification" | "unsupported";
export const outcomeLabels: Record<TeamOutcome, string> = { passed: "代码审查通过", rejected: "审查未通过", failed: "执行失败", stopped: "任务已停止", limit: "任务已超限", clarification: "需要补充需求", unsupported: "暂不支持此需求" };
export function isTeamOutcome(value: unknown): value is TeamOutcome { return typeof value === "string" && Object.hasOwn(outcomeLabels, value); }
export class TeamError extends Error {
  constructor(public outcome: Exclude<TeamOutcome, "passed">, message: string) { super(message); }
}
export type TeamRecord = { protocol: typeof TEAM_PROTOCOL | "atoms-team/1"; taskId: string; projectId: string; deliveries: Delivery[]; calls: ModelCall[]; check?: ToolResult; review?: CodeReview; codeHash?: string; baseCodeHash?: string; durationMs?: number; outcome?: TeamOutcome };
export type ToolEnvelope = { request: ToolRequest; ticket: string };

// Platform rules are owned by the platform, never supplied/relaxed by QA.
// Only application-specific setup and data shape come from the frozen spec.
export function mandatoryScenarios(spec: Specification, probe: PlatformProbe | undefined = spec.probe): Scenario[] {
  if (!spec.summary || !Array.isArray(spec.requirements) || !spec.requirements.length || spec.requirements.length > 8 || new Set(spec.requirements.map(r => r.id)).size !== spec.requirements.length || spec.requirements.some(r => !/^[a-z][a-z0-9-]{0,50}$/.test(r.id) || !r.description)) throw new Error("需求规格缺少唯一必检项");
  if (!probe || !Array.isArray(probe.prepare) || probe.prepare.length > 12 || probe.prepare.some(c => c.op !== "input") || typeof probe.commitSelector !== "string" || !probe.changed || !Array.isArray(probe.changed.path) || (probe.changed.equals !== null && typeof probe.changed.equals === "object")) throw new Error("需求规格缺少数据保护检查合同");
  const status = '[data-atoms-status]';
  const enabled = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)';
  const click: Command = { op: "click", selector: probe.commitSelector };
  const wait: Command = { op: "wait", ms: 700 };
  const data: Command = { op: "data", path: [], equals: probe.seed };
  const bridge = (property: "saveAttempts" | "commits" | "rejectedSaves", equals: number): Command => ({ op: "bridge", property, equals });
  const assert = (selector: string, property: "text" | "count" | "inert", equals: Json): Command => ({ op: "assert", selector, property, equals });
  const scenario = (id: string, commands: Command[], extra = {}): Scenario => ({ id, seed: probe.seed, ...extra, checks: commands.map((command, i) => ({ id: `${id}-${i}`, label: `${id} ${i + 1}`, command })) });
  return [
    scenario("platform-timing", [assert(enabled, "count", 0), bridge("saveAttempts", 0), wait, ...probe.prepare, click, assert("body", "inert", true), assert(status, "text", "正在保存"), { ...click, probeWhileInert: true }, data, wait, assert("body", "inert", false), assert(status, "text", "已保存"), { op: "data", ...probe.changed }, bridge("saveAttempts", 1), bridge("commits", 1)], { loadDelayMs: 500, saveDelayMs: 500 }),
    scenario("platform-read-failure", [wait, assert(status, "text", "读取失败"), assert(enabled, "count", 0), bridge("saveAttempts", 0), bridge("commits", 0), data], { fault: "read" }),
    scenario("platform-save-failure", [wait, ...probe.prepare, click, assert("body", "inert", true), wait, assert(status, "text", "保存失败"), data, bridge("saveAttempts", 1), bridge("rejectedSaves", 1), bridge("commits", 0)], { fault: "save", saveDelayMs: 500 }),
  ];
}
export function completePlan(spec: Specification, business: Scenario[], probe: PlatformProbe | undefined = spec.probe): Scenario[] {
  if (!Array.isArray(business) || business.length !== spec.requirements.length || business.some((s, i) => s.id !== spec.requirements[i].id || s.fault || !s.checks?.some(c => c.command.op === "assert" || c.command.op === "data"))) throw new Error("业务检查缺项或与冻结需求不一致");
  return [...mandatoryScenarios(spec, probe), ...business.map(s => ({...s, checks: [
    {id:"platform-startup-wait",label:"等待检查页面读取合成数据",command:{op:"wait" as const,ms:150}},
    ...s.checks.flatMap(c => {
      const check = c.command.op === "data" ? {...c, command:{...c.command,path:c.command.path.map(k => typeof k === "number" && Number.isSafeInteger(k) && k >= 0 ? String(k) : k)}} : c;
      return c.command.op === "click" ? [check, {id:`platform-settle-${c.id}`,label:"等待业务操作及合成数据桥完成",command:{op:"wait" as const,ms:150}}] : [check];
    }),
  ]}))];
}
