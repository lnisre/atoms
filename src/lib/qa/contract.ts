export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Observation = "text" | "value" | "count" | "disabled" | "inert";
export type Command =
  | { op: "observe"; selector: string; property: Observation }
  | { op: "input"; selector: string; value: string }
  | { op: "click"; selector: string; probeWhileInert?: true }
  | { op: "wait"; ms: number }
  | { op: "assert" | "wait-for"; selector: string; property: Observation; equals: Json }
  | { op: "data"; path: string[]; equals: Json }
  | { op: "bridge"; property: "saveAttempts" | "rejectedSaves" | "commits"; equals: number };
export type Check = { id: string; label: string; command: Command };
export type Scenario = {
  id: string;
  seed: Json;
  fault?: "read" | "save" | "no-result";
  loadDelayMs?: number;
  saveDelayMs?: number;
  checks: Check[];
};
export type ToolRequest = {
  protocol: "atoms-qa/1";
  taskId: string;
  requestId: string;
  codeHash: string;
  planHash: string;
  html: string;
  deadline: number;
  scenarios: Scenario[];
};
export type CheckResult = {
  scenarioId: string;
  checkId: string;
  command: Command;
  expected: Json;
  actual: Json;
  status: "passed" | "failed" | "tool-error" | "not-run";
  startedAt: number;
  endedAt: number;
};
export type ToolResult = Pick<ToolRequest, "protocol" | "taskId" | "requestId" | "codeHash" | "planHash"> & {
  status: "passed" | "failed" | "cancelled" | "timeout" | "tool-error";
  results: CheckResult[];
  detail: string;
};
export function expected(command: Command): Json {
  return "equals" in command ? command.equals : command.op === "input" ? command.value : command.op === "wait" ? command.ms : "executed";
}
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal(Reflect.get(a, k), Reflect.get(b, k)));
}
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
// Gate at the task boundary, not a model's verdict. Every planned action must
// occur exactly once, in order, with its original expectation and code identity.
export function validateResult(request: ToolRequest, result: ToolResult): boolean {
  if (["protocol", "taskId", "requestId", "codeHash", "planHash"].some(k => Reflect.get(request, k) !== Reflect.get(result, k))) return false;
  if (!Array.isArray(result.results)) return false;
  const checks = request.scenarios.flatMap(s => s.checks.map(c => ({ scenarioId: s.id, ...c })));
  if (checks.length !== result.results.length) return false;
  return checks.every((check, i) => {
    const row = result.results[i];
    return row.scenarioId === check.scenarioId && row.checkId === check.id &&
      equal(row.command, check.command) && equal(row.expected, expected(check.command)) &&
      ["passed", "failed", "tool-error", "not-run"].includes(row.status) &&
      (row.status !== "passed" || check.command.op === "observe" || equal(row.actual, expected(check.command))) &&
      Number.isFinite(row.startedAt) && row.endedAt >= row.startedAt &&
      (result.status !== "passed" || row.status === "passed");
  });
}

// Bound tool inputs even when a future role, rather than the fixture endpoint,
// supplies a plan. No evaluation, arbitrary JS, URL navigation or free terminal.
export function validateRequest(request: ToolRequest): void {
  if (request.protocol !== "atoms-qa/1" || typeof request.html !== "string" || request.html.length > 500_000 ||
      !Number.isFinite(request.deadline) || request.deadline > Date.now() + 240_000 ||
      !Array.isArray(request.scenarios) || !request.scenarios.length || request.scenarios.length > 12 ||
      !/^[a-f0-9]{64}$/.test(request.codeHash) || !/^[a-f0-9]{64}$/.test(request.planHash)) throw new Error("invalid tool request");
  const scenarioIds = new Set<string>();
  for (const s of request.scenarios) {
    if (scenarioIds.has(s.id) || !s.id || !s.checks.length || s.checks.length > 100 || JSON.stringify(s.seed).length > 1_000_000) throw new Error("invalid scenario");
    scenarioIds.add(s.id);
    for (const delay of [s.loadDelayMs, s.saveDelayMs]) if (delay !== undefined && (!Number.isFinite(delay) || delay < 0 || delay > 2000)) throw new Error("invalid delay");
    const ids = new Set<string>();
    for (const check of s.checks) {
      if (!check.id || ids.has(check.id)) throw new Error("duplicate check");
      ids.add(check.id);
      const c = check.command;
      if (!["observe", "input", "click", "wait", "assert", "wait-for", "data", "bridge"].includes(c.op)) throw new Error("unsupported operation");
      if ("selector" in c && (typeof c.selector !== "string" || !c.selector || c.selector.length > 300)) throw new Error("invalid selector");
      if (["assert", "wait-for", "data", "bridge"].includes(c.op) && (!("equals" in c) || JSON.stringify(c.equals) === undefined)) throw new Error("missing expectation");
      if (c.op === "wait" && (!Number.isFinite(c.ms) || c.ms < 0 || c.ms > 2500)) throw new Error("invalid wait");
      if (c.op === "input" && (typeof c.value !== "string" || c.value.length > 8000)) throw new Error("invalid input");
      if (c.op === "data" && (!Array.isArray(c.path) || c.path.length > 16 || c.path.some(k => typeof k !== "string" || ["__proto__", "prototype", "constructor"].includes(k)))) throw new Error("invalid data path");
      if ((c.op === "assert" || c.op === "wait-for" || c.op === "observe") && !["text", "count", "value", "disabled", "inert"].includes(c.property)) throw new Error("invalid observation");
      if (c.op === "bridge" && !["saveAttempts", "rejectedSaves", "commits"].includes(c.property)) throw new Error("invalid bridge observation");
    }
  }
}
