import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const evidenceDir = process.env.QA_EVIDENCE_DIR;
async function evidence(page: Page, name: string) {
  const record = JSON.parse((await page.getByTestId("qa-evidence").textContent())!);
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}/${name}.json`, JSON.stringify({ url: page.url(), observedAt: new Date().toISOString(), ...record }, null, 2));
    if (name === "todo") await page.screenshot({ path: `${evidenceDir}/todo.png`, fullPage: true });
  }
  return record;
}
async function start(page: Page, fixture = "todo", variant = "normal") {
  await page.goto("/qa");
  await page.getByLabel("应用", { exact: true }).selectOption(fixture);
  await page.getByLabel("验证场景").selectOption(variant);
  await page.getByRole("button", { name: "开始检查" }).click();
  await expect(page.getByTestId("qa-status")).not.toHaveText("尚未执行");
}
for (const fixture of ["todo", "reading"]) test(`QA ${fixture}: real browser and HTTP round trip`, async ({ page }) => {
  const completions: unknown[] = [];
  page.on("response", async r => {
    if (r.url().endsWith("/api/qa") && r.request().postDataJSON().action === "complete") completions.push(await r.json());
  });
  await start(page, fixture);
  await expect(page.getByTestId("qa-status")).toContainText("passed", { timeout: 25000 });
  const record = await evidence(page, fixture);
  expect(record.result.status).toBe("passed");
  expect(record.result.results.every((r: { status: string }) => r.status === "passed")).toBeTruthy();
  expect(completions).toHaveLength(1);
  expect(completions[0]).toMatchObject({ taskId: record.request.taskId, codeHash: record.request.codeHash, status: "passed" });
  expect(await page.locator("iframe").count()).toBe(0);
});
for (const variant of ["read-bug", "save-bug", "tamper", "no-result", "timeout"]) test(`QA detects ${variant}`, async ({ page }) => {
  await start(page, "todo", variant);
  await expect(page.getByRole("button", { name: "开始检查" })).toBeEnabled({ timeout: 25000 });
  const record = await evidence(page, variant);
  if (variant === "tamper") {
    expect(record.result.status).toBe("passed");
    expect(record.result.results.find((r: {command: {op: string}}) => r.command.op === "observe").actual).toContain("旧待办");
    expect(record.result.results.some((r: {actual: unknown}) => r.actual === "forged")).toBeFalsy();
  } else {
    await expect(page.getByTestId("qa-status")).not.toContainText("passed");
    expect(record.result.status).not.toBe("passed");
  }
  if (variant === "read-bug") {
    expect(record.result.results).toContainEqual(expect.objectContaining({ scenarioId: "read-failure", command: expect.objectContaining({ property: "disabled" }), actual: false, status: "failed" }));
    expect(record.result.results).toContainEqual(expect.objectContaining({ scenarioId: "read-failure", command: expect.objectContaining({ property: "saveAttempts" }), actual: 1, status: "failed" }));
    expect(record.result.results).toContainEqual(expect.objectContaining({ scenarioId: "read-failure", command: expect.objectContaining({ property: "commits" }), actual: 0, status: "passed" }));
  }
  if (["no-result", "timeout"].includes(variant)) expect(record.result.results.some((r: { status: string }) => r.status === "not-run")).toBeTruthy();
});
test("QA stops in flight and a new task never receives its results", async ({ page }) => {
  let completed = 0;
  page.on("request", r => { if (r.url().endsWith("/api/qa") && r.postDataJSON().action === "complete") completed++; });
  await start(page, "todo", "slow");
  await expect(page.locator("iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "停止检查" }).click();
  await expect(page.getByTestId("qa-status")).toContainText("cancelled");
  const stopped = await evidence(page, "cancelled");
  expect(stopped.result.results.every((r: { status: string }) => r.status === "not-run")).toBeTruthy();
  expect(completed).toBe(0);
  await page.getByLabel("验证场景").selectOption("normal");
  await page.getByRole("button", { name: "开始检查" }).click();
  await expect(page.getByTestId("qa-status")).toContainText("passed", { timeout: 25000 });
  const next = await evidence(page, "after-cancel");
  expect(next.request.taskId).not.toBe(stopped.request.taskId);
  expect(next.result.taskId).toBe(next.request.taskId);
  expect(completed).toBe(1);
});
test("QA rejects wrong code/task/plan, missing and late results at the HTTP boundary", async ({ page, request }) => {
  let envelope: unknown;
  page.on("response", async r => { if (r.url().endsWith("/api/qa") && r.request().postDataJSON().action === "start") envelope = await r.json(); });
  await start(page);
  await expect(page.getByTestId("qa-status")).toContainText("passed", { timeout: 25000 });
  const record = await evidence(page, "protocol-baseline");
  for (const patch of [{ taskId: "other" }, { codeHash: "other" }, { results: [] }, { planHash: "other" }, { results: record.result.results.map((r: object, i: number) => i === 0 ? { ...r, status: "not-run" } : r) }, { results: record.result.results.map((r: object, i: number) => i === 0 ? { ...r, expected: "lowered" } : r) }]) {
    const response = await request.post("/api/qa", { data: { action: "complete", envelope, result: { ...record.result, ...patch } } });
    expect(response.status()).toBe(400);
  }
  // Acquire a server-signed short deadline and wait for its actual expiry.
  const short = await (await request.post("/api/qa", { data: { action: "start", taskId: record.request.taskId, fixture: "todo", variant: "timeout" } })).json();
  await page.waitForTimeout(400);
  // Deliberately forge a structurally complete "passed" receipt after expiry.
  // This is a protocol rejection probe, not claimed browser execution evidence.
  const r = { ...record.result, taskId: short.request.taskId, requestId: short.request.requestId, codeHash: short.request.codeHash, planHash: short.request.planHash, status: "passed", results: short.request.scenarios.flatMap((s: {id: string; checks: { id: string; command: Record<string, unknown> }[]}) => s.checks.map(c => {
    const expected = c.command.equals ?? (c.command.op === "input" ? c.command.value : c.command.op === "wait" ? c.command.ms : "executed");
    return { scenarioId: s.id, checkId: c.id, command: c.command, expected, actual: expected, status: "passed", startedAt: Date.now(), endedAt: Date.now() };
  })) };
  const late = await request.post("/api/qa", { data: { action: "complete", envelope: short, result: r } });
  expect(late.status()).toBe(200);
  expect((await late.json()).status).toBe("timeout");
});
test("QA synthetic data never enters active formal or trial data", async ({ page, context }) => {
  test.setTimeout(60000);
  const { qualificationFixture } = await import("../../src/lib/qa/fixtures");
  const html = qualificationFixture("todo", "normal").html;
  await page.route("**/api/generate", r => r.fulfill({ json: { html, model: "handwritten-fixture", durationMs: 1, generatedAt: "test" } }));
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("三类数据隔离");
  await page.getByRole("button", { name: "开始生成" }).click();
  const f = page.frameLocator("iframe");
  await f.locator("#task-title").fill("formal-sentinel");
  await f.locator("#add-task").press("Enter");
  await expect(f.locator("#feedback")).toHaveText("已保存");
  const url = page.url();
  await page.getByLabel("追加修改需求").fill("受控候选");
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect(page.locator(".preview-toolbar")).toContainText("候选试用");
  await f.locator("#task-title").fill("trial-sentinel");
  await f.locator("#add-task").press("Enter");
  await expect(f.locator("#feedback")).toHaveText("已保存");
  const qa = await context.newPage();
  const outgoing: string[] = [];
  qa.on("request", r => { if (r.url().endsWith("/api/qa")) outgoing.push(r.postData() ?? ""); });
  await start(qa, "reading");
  await expect(qa.getByTestId("qa-status")).toContainText("passed", { timeout: 25000 });
  await evidence(qa, "isolation");
  expect(outgoing.join("\n")).not.toMatch(/formal-sentinel|trial-sentinel/);
  await expect(f.locator("#records")).toContainText("formal-sentinel");
  await expect(f.locator("#records")).toContainText("trial-sentinel");
  await expect(f.locator("#records")).not.toContainText("合成书名");
  const formal = await context.newPage(); await formal.goto(url);
  await expect(formal.frameLocator("iframe").locator("#records")).toContainText("formal-sentinel");
  await expect(formal.frameLocator("iframe").locator("#records")).not.toContainText("trial-sentinel");
  await page.getByRole("button", { name: "采用修改", exact: true }).click();
  await expect(f.locator("#records li")).toHaveCount(1);
  await expect(f.locator("#records")).toContainText("formal-sentinel");
  await expect(f.locator("#records")).not.toContainText("trial-sentinel");
});
