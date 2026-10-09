import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { SavedProject } from "../../src/lib/project-store";
import { EXAMPLE_STATE, EXAMPLE_HASH } from "../../src/lib/builtin-example";
import { fulfillGeneration } from "./team-fixture";

const asset = "**/examples/tip-calculator-v1.html";
const marker = "$atoms:workspace:tip-calculator";
const legacySource = { kind: "builtin-example", templateId: "focus-pomodoro", version: 1,
  sourceCodeHash: "a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489",
  codeHash: "d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f" } as const;
const timerHtml = readFileSync("public/examples/pomodoro-v1.html", "utf8");
const timer: SavedProject & { futureField: unknown } = {
  id: "legacy", title: "示例 · 专注番茄钟", requirement: "保留我的番茄钟", updatedAt: "2026-10-02T00:00:00Z",
  result: { html: timerHtml, model: "historical", generatedAt: "legacy", durationMs: 0 },
  exampleSource: legacySource, futureField: { keep: ["未知项目字段"] },
};
const timerData = { projectId: timer.id, state: { mode: "focus", remaining: 987, running: false, completedFocusCount: 4, custom: { keep: [1, 2] } } };
type DataRow = { projectId: string; state?: Record<string, unknown>; completed?: boolean };
const frame = (page: Page) => page.frameLocator("iframe");
const tipCard = (page: Page) => page.getByRole("region", { name: "已有项目" }).getByRole("button", { name: /示例 · 小费计算器/ });
async function database(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<{ projects: SavedProject[]; data: DataRow[] }>((resolve, reject) => {
      const tx = db.transaction(["projects", "applicationData"]), p = tx.objectStore("projects").getAll(), d = tx.objectStore("applicationData").getAll();
      tx.oncomplete = () => resolve({ projects: p.result, data: d.result }); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  });
}
// Only establish the old deployment's state. Subsequent saves/adoptions use UI.
async function seed(page: Page, projects: SavedProject[] = [timer], data: DataRow[] = [timerData], firstVisit = true) {
  await page.goto("/?project=seed-missing");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  await page.evaluate(async serialized => {
    const { projects, data, firstVisit } = JSON.parse(serialized) as { projects: SavedProject[]; data: DataRow[]; firstVisit: boolean };
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["projects", "applicationData"], "readwrite");
      for (const p of projects) tx.objectStore("projects").put(p);
      for (const row of data) tx.objectStore("applicationData").put(row);
      if (firstVisit) tx.objectStore("applicationData").put({ projectId: "$atoms:workspace:first-visit", completed: true });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, JSON.stringify({ projects, data, firstVisit }));
}
function expectRetired(actual: SavedProject, original: SavedProject) {
  const { exampleSource, ...personal } = original;
  expect(actual).toEqual({ ...personal, title: original.title === "示例 · 专注番茄钟" ? "专注番茄钟" : original.title, retiredExampleSource: exampleSource });
}

for (const branch of ["旧首访标记", "无标记其他项目", "旧示例已移除", "已初始化空工作区", "已装小费但无标记"] as const) {
  test(`升级分支：${branch}，独立补入且刷新不重灌`, async ({ page }) => {
    const other = { ...timer, id: "other", title: "我的普通项目", exampleSource: undefined };
    const existingTip = { ...timer, id: "tip", title: "我的小费副本", result: { ...timer.result, html: "<!doctype html><html><head></head><body>已改小费</body></html>" }, exampleSource: { ...legacySource, templateId: "tip-calculator" as const, codeHash: EXAMPLE_HASH } };
    const projects = branch === "已初始化空工作区" ? [] : branch === "已装小费但无标记" ? [timer, existingTip] : branch === "旧示例已移除" || branch === "无标记其他项目" ? [other] : [timer];
    const data = branch === "已装小费但无标记" ? [timerData, { projectId: "tip", state: { bill: 80, custom: true } }] : projects.length ? [{ ...timerData, projectId: projects[0].id }] : [];
    await seed(page, projects, data, branch !== "无标记其他项目");
    let downloads = 0; page.on("request", r => { if (r.url().includes("/examples/")) downloads++; });
    await page.goto("/"); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
    const after = await database(page), tip = after.projects.find(p => p.exampleSource?.templateId === "tip-calculator")!;
    expect(after.projects).toHaveLength(projects.length + (branch === "已装小费但无标记" ? 0 : 1));
    expect(after.data.find(d => d.projectId === marker)?.completed).toBe(true);
    for (const p of projects) {
      const saved = after.projects.find(s => s.id === p.id)!;
      if (p.exampleSource?.templateId === "focus-pomodoro") expectRetired(saved, p); else expect(saved).toEqual(p);
    }
    for (const row of data) expect(after.data.find(d => d.projectId === row.projectId)).toEqual(row);
    if (branch !== "已装小费但无标记") expect(after.data.find(d => d.projectId === tip.id)?.state).toEqual(EXAMPLE_STATE);
    // Dev Strict Mode can start preparation twice; uniqueness is a committed
    // project/data invariant, not a count of concurrent asset reads.
    if (branch === "已装小费但无标记") expect(downloads).toBe(0);
    else expect(downloads).toBeGreaterThan(0);
    const installedDownloads = downloads;
    await page.reload(); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0); expect(await database(page)).toEqual(after);
    expect(downloads).toBe(installedDownloads);
  });
}

test("竞争保护：素材准备期间旧标签通过 UI 保存并采用，多标签升级只提交一次", async ({ page, context }) => {
  await seed(page);
  await page.route(asset, r => r.fulfill({ status: 503, body: "temporarily unavailable" }));
  await page.goto("/?project=legacy");
  await expect(frame(page).getByRole("button", { name: "开始", exact: true })).toBeEnabled();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  const upgrading = await context.newPage(), concurrent = await context.newPage();
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(r => { release = r; }), seen = new Promise<void>(r => { requested = r; });
  await upgrading.route(asset, async r => { requested(); await gate; await r.continue(); });
  await concurrent.route(asset, async r => { await gate; await r.continue(); });
  await Promise.all([upgrading.goto("/?project=legacy"), concurrent.goto("/")]); await seen;
  await frame(page).getByRole("button", { name: "重置", exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toHaveText("已保存");
  let calls = 0;
  await page.route("**/api/generate", async route => {
    calls++; const body = route.request().postDataJSON();
    expect(body.baseHtml).toBe(timerHtml);
    await fulfillGeneration(route, { json: { html: body.baseHtml.replace("<h1>专注番茄钟</h1>", "<h1>下载期间采用</h1>"), model: "synthetic", durationMs: 1, generatedAt: "racing-adoption" } });
  });
  await page.getByLabel("追加修改需求", { exact: true }).fill("标题改为下载期间采用");
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect(frame(page).getByRole("heading", { name: "下载期间采用" })).toBeVisible();
  await page.getByRole("button", { name: "采用修改", exact: true }).click();
  await expect(page.getByRole("button", { name: "采用修改", exact: true })).toHaveCount(0);
  await expect(page.getByText("执行记录正在保存", { exact: false })).toHaveCount(0);
  const latest = await database(page);
  expect(latest.projects[0].modificationRecords).toHaveLength(1);
  expect(latest.data.find(d => d.projectId === "legacy")?.state?.remaining).toBe(1500);
  release();
  await expect(frame(upgrading).getByRole("heading", { name: "下载期间采用" })).toBeVisible();
  await expect(tipCard(concurrent)).toHaveCount(1);
  const after = await database(upgrading);
  expect(after.projects).toHaveLength(2);
  expectRetired(after.projects.find(p => p.id === "legacy")!, latest.projects[0]);
  expect(after.data.find(d => d.projectId === "legacy")).toEqual(latest.data.find(d => d.projectId === "legacy"));
  expect(new URL(upgrading.url()).searchParams.get("project")).toBe("legacy");
  // An already-open client continues saving after retirement without resurrecting identity.
  await frame(page).getByRole("button", { name: "开始", exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toHaveText("已保存");
  expect((await database(page)).projects.find(p => p.id === "legacy")?.exampleSource).toBeUndefined();
  await page.reload(); await expect(page.locator(".topbar h1")).toHaveText("专注番茄钟");
  await expect(frame(page).getByRole("heading", { name: "下载期间采用" })).toBeVisible();
  expect(calls).toBe(1);
});

for (const fault of ["事务", "素材校验", "读取"] as const) test(`升级${fault}失败保全，工作台重试不丢源码与输入`, async ({ page }) => {
  await seed(page);
  const before = await database(page);
  if (fault === "素材校验") await page.route(asset, r => r.fulfill({ body: "invalid" }));
  else await page.addInitScript(fault => {
    const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
    if (fault === "读取") IDBObjectStore.prototype.get = function (key) { if (key === "$atoms:workspace:tip-calculator") throw new DOMException("read failed"); return get.call(this, key); };
    else IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "applicationData" && args[0].projectId === "$atoms:workspace:tip-calculator") request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    Object.assign(window, { restoreStorage: () => { IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.get = get; } });
  }, fault);
  await page.goto("/?project=legacy");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  await expect(frame(page).locator("#timeDisplay")).toHaveText("16:27");
  expect(await database(page)).toEqual(before);
  await page.getByLabel("追加修改需求", { exact: true }).fill("不要丢失这段输入");
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  const iframe = await page.locator("iframe").elementHandle();
  if (fault === "素材校验") await page.unroute(asset); else await page.evaluate(() => Reflect.get(window, "restoreStorage")());
  await page.getByRole("button", { name: "重试准备示例", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".topbar h1")).toHaveText("专注番茄钟");
  await expect(page.locator("pre code")).toHaveText(timerHtml);
  await expect(page.getByLabel("追加修改需求", { exact: true })).toHaveValue("不要丢失这段输入");
  expect(await iframe!.evaluate(el => el === document.querySelector("iframe"))).toBe(true);
  const after = await database(page);
  expect(after.projects).toHaveLength(2); expectRetired(after.projects.find(p => p.id === "legacy")!, timer);
  expect(after.data.find(d => d.projectId === "legacy")).toEqual(timerData);
});

for (const status of ["blocked", "allowed"] as const) test(`升级保留 ${status} 待验证原始源码及限制，跨项目不串源码`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const html = `<!doctype html><html><head></head><body><h1>待验证源码</h1><script>${status === "blocked" ? "while(true){}" : "document.body.dataset.trial='only';"}</script></body></html>`;
  const project: SavedProject = { ...timer, title: "个人受限项目", result: { ...timer.result, html: "<!doctype html><html><head></head><body>兼容说明页</body></html>" }, draftResult: { ...timer.result, html }, previewPolicy: { status, reasons: status === "blocked" ? ["无条件空循环"] : [], dataMode: "trial", adoption: "blocked", review: "issues" } };
  await seed(page, [project]);
  let calls = 0; page.on("request", r => { if (r.url().includes("/api/generate")) calls++; });
  await page.goto("/?project=legacy");
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  await expect(page.locator("pre code")).toHaveText(html);
  await page.getByRole("searchbox", { name: "在当前文件中搜索" }).fill("待验证源码");
  await expect(page.getByLabel("当前文件搜索结果")).toHaveText("1 / 1");
  await page.getByRole("button", { name: "复制当前文件", exact: true }).click();
  await expect(page.getByText("已复制当前文件的完整源码", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(html);
  await expect(page.getByRole("button", { name: "使用此版本", exact: true })).toBeDisabled();
  if (status === "blocked") { await expect(page.locator("iframe")).toHaveCount(0); await expect(page.getByText(/禁止运行：/)).toBeVisible(); }
  else await expect(page.getByText(/不可采用/).first()).toBeVisible();
  const after = await database(page);
  expectRetired(after.projects.find(p => p.id === "legacy")!, project);
  expect(after.data.find(d => d.projectId === "legacy")).toEqual(timerData);
  await page.getByRole("button", { name: "Atoms 首页", exact: true }).click(); await tipCard(page).click();
  await expect(page.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  await expect(page.locator("pre code")).not.toContainText("待验证源码");
  await expect(page.getByRole("searchbox", { name: "在当前文件中搜索" })).toHaveValue("");
  await page.goto("/?project=legacy");
  await expect(page.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "查看代码", exact: true }).click();
  await expect(page.locator("pre code")).toHaveText(html); expect(await database(page)).toEqual(after); expect(calls).toBe(0);
});
