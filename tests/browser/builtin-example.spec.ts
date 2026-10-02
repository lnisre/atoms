import { expect, test, type Page } from "@playwright/test";
import { fulfillGeneration } from "./team-fixture";

const marker = "$atoms:workspace:first-visit";
const card = (page: Page) => page.getByRole("region", { name: "已有项目" }).getByRole("button", { name: /示例 · 专注番茄钟/ });
const frame = (page: Page) => page.frameLocator("iframe");
const baseTime = Date.parse("2026-10-02T08:00:00Z");
async function database(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise<{ projects: Record<string, unknown>[]; data: { projectId: string; state?: Record<string, unknown> }[] }>((resolve, reject) => {
        const tx = db.transaction(["projects", "applicationData"]);
        const p = tx.objectStore("projects").getAll(), d = tx.objectStore("applicationData").getAll();
        tx.oncomplete = () => resolve({ projects: p.result, data: d.result }); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}
async function openExample(page: Page) {
  await page.goto("/");
  await card(page).click();
  await expect(frame(page).getByRole("button", { name: "开始", exact: true })).toBeEnabled();
}
// Control Date.now before the generated app starts, including new opaque srcdoc
// frames. Clock-only injection does not change saved HTML, state or assertions;
// real interval callbacks, DOM actions and the platform data bridge still run.
const clockPages = new WeakSet<Page>();
function installFrameClock() {
  const attribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLIFrameElement && name.toLowerCase() === "srcdoc") {
      value = value.replace("</head>", `<script>Date.now = () => ${Date.now()};</script></head>`);
    }
    return attribute.call(this, name, value);
  };
  const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc")!;
  Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
    ...descriptor,
    set(value: string) {
      descriptor.set!.call(this, value.replace("</head>", `<script>Date.now = () => ${Date.now()};</script></head>`));
    },
  });
}
async function setTime(page: Page, time: number) {
  await page.clock.setFixedTime(time);
  if (!clockPages.has(page)) {
    await page.addInitScript(installFrameClock);
    await page.evaluate(installFrameClock);
    clockPages.add(page);
  }
  await Promise.all(page.frames().map(f => f.evaluate(now => { Date.now = () => now; }, time)));
}
async function action(page: Page, name: string) {
  const now = await page.evaluate(() => Date.now());
  await Promise.all(page.frames().slice(1).map(f => f.evaluate(now => { Date.now = () => now; }, now)));
  await frame(page).getByRole("button", { name, exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toHaveText("已保存");
}
async function seedOld(page: Page) {
  await page.goto("/?project=old");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["projects", "applicationData"], "readwrite");
      tx.objectStore("projects").put({ id: "old", title: "旧项目", requirement: "旧需求", updatedAt: "2026-09-01", result: { html: "<!doctype html><html><head></head><body>旧应用</body></html>", model: "historical", generatedAt: "old", durationMs: 1 } });
      tx.objectStore("applicationData").put({ projectId: "old", state: { unknown: ["保留"] } });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  });
}

test("新工作区只创建一份独立示例、无业务记录、无伪造历史且零模型调用", async ({ page, browser }, info) => {
  let calls = 0; page.on("request", r => { if (r.url().includes("/api/generate")) calls++; });
  await page.goto("/");
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByLabel("你想做什么？")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  const first = await database(page);
  expect(first.projects).toHaveLength(1);
  expect(first.data).toEqual([{ projectId: marker, kind: "workspace-initialization", completed: true }]);
  expect(first.projects[0].initialGeneration).toBeUndefined();
  await page.screenshot({ path: info.outputPath("home-example.png") });
  await card(page).click();
  await expect(page.getByRole("region", { name: "示例项目记录" })).toBeVisible();
  await expect(page.getByText("你 · 初始需求")).toHaveCount(0);
  const conversation = page.getByRole("region", { name: "示例项目记录" });
  await expect(conversation.getByText("示例需求", { exact: true })).toBeVisible();
  await expect(conversation.getByRole("heading", { name: "助手 示例项目" })).toBeVisible();
  await expect(conversation.locator(".assistant-reply")).toContainText("这份专注番茄钟已经准备好了");
  await expect(conversation.getByText("示例初始应用 · 已准备", { exact: true })).toBeVisible();
  await expect(conversation.getByText("平台执行记录", { exact: true })).toHaveCount(0);
  await conversation.getByText("示例交付说明", { exact: true }).click();
  await expect(conversation).toContainText("本次打开没有执行模型生成或团队审查");
  expect(await database(page)).toEqual(first);
  await expect(frame(page).locator("#timeDisplay")).toHaveText("25:00");
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 0 次");
  await expect(frame(page).locator("#toggleBtn")).toHaveCSS("background-color", "rgb(34, 197, 94)");
  await conversation.getByText("示例交付说明", { exact: true }).click();
  await page.getByRole("region", { name: "项目对话与详情" }).evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath("workbench-example.png") });
  await action(page, "开始");
  await page.reload();
  await expect(frame(page).getByRole("button", { name: "暂停", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "助手 示例项目" })).toBeVisible();
  expect(calls).toBe(0);
  const other = await browser.newContext(); const p2 = await other.newPage();
  await openExample(p2);
  const independent = await database(p2);
  expect(independent.projects[0].id).not.toBe(first.projects[0].id);
  expect(independent.data).toHaveLength(1);
  await expect(frame(p2).locator("#timeDisplay")).toHaveText("25:00");
  await other.close();
});

test("并发首访只有一份，旧标签无需升级可枚举项目，删除后与模板更新均不重灌", async ({ page, context }) => {
  const p2 = await context.newPage();
  await Promise.all([page.goto("/"), p2.goto("/")]);
  await expect(card(page)).toHaveCount(1); await expect(card(p2)).toHaveCount(1);
  const before = await database(page); expect(before.projects).toHaveLength(1);
  let downloads = 0;
  await context.route("**/examples/pomodoro-v1.html", route => { downloads++; return route.fulfill({ body: "future template" }); });
  await page.reload(); await expect(card(page)).toHaveCount(1);
  expect((await database(page)).projects).toEqual(before.projects);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").clear(); tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
  await expect(card(page)).toHaveCount(0); expect(downloads).toBe(0);
  expect((await database(page)).data).toHaveLength(1);
});

test("已有项目保全、记录已处理，缺失深链接不被示例替换", async ({ page }) => {
  await seedOld(page);
  const original = await database(page); expect(original.data).toHaveLength(1);
  await page.goto("/"); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
  const after = await database(page);
  expect(after.projects).toEqual(original.projects);
  expect(after.data.find(d => d.projectId === "old")).toEqual(original.data[0]);
  expect(after.data.some(d => d.projectId === marker)).toBe(true);
  await expect(card(page)).toHaveCount(0);
  await page.goto("/?project=missing"); await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.goto("/?project=old"); await expect(frame(page).getByText("旧应用")).toBeVisible();
});

test("素材校验失败可重试且不丢输入、不留半份记录", async ({ page }) => {
  await page.route("**/examples/pomodoro-v1.html", r => r.fulfill({ body: "invalid release" }));
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  await page.getByLabel("你想做什么？").fill("保留我的需求");
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.unroute("**/examples/pomodoro-v1.html");
  await page.getByRole("button", { name: "重试读取与准备" }).click();
  await expect(card(page)).toHaveCount(1);
  await expect(page.getByLabel("你想做什么？")).toHaveValue("保留我的需求");
});

test("初始化事务中止回滚项目与标记，重试成功", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "applicationData" && args[0].kind === "workspace-initialization") request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
  });
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("示例暂时准备失败");
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.evaluate(() => Reflect.get(window, "restorePut")());
  await page.getByRole("button", { name: "重试读取与准备" }).click();
  await expect(card(page)).toHaveCount(1); expect((await database(page)).data).toHaveLength(1);
});

test("读库失败不请求素材、不写标记，存储恢复可重试", async ({ page }) => {
  let downloads = 0; page.on("request", r => { if (r.url().includes("/examples/")) downloads++; });
  await page.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new DOMException("read failure"); };
    Object.assign(window, { restoreRead: () => { IDBObjectStore.prototype.getAll = getAll; } });
  });
  await page.goto("/"); await expect(page.getByRole("main").getByRole("alert")).toContainText("当前无法保证保存与恢复");
  expect(downloads).toBe(0);
  await page.evaluate(() => Reflect.get(window, "restoreRead")());
  expect(await database(page)).toEqual({ projects: [], data: [] });
  await page.getByRole("button", { name: "重试读取与准备" }).click(); await expect(card(page)).toHaveCount(1);
});

test("素材准备期间另一旧标签保存正常项目，初始化不追加或覆盖", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const seen = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/examples/pomodoro-v1.html", async r => { requested(); await gate; await r.continue(); });
  await page.goto("/"); await seen;
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("projects", "readwrite"); tx.objectStore("projects").put({ id: "racing", title: "同时保存", requirement: "正常项目", updatedAt: "2026-10-02", result: { html: "<!doctype html><html><head></head><body>保留</body></html>", generatedAt: "race", model: "old", durationMs: 1 } }); tx.oncomplete = () => resolve(); }); db.close();
  });
  release(); await expect(page.getByText("正在读取已有项目…")).toHaveCount(0);
  const db = await database(page); expect(db.projects.map(p => p.id)).toEqual(["racing"]);
  expect(db.data).toHaveLength(1); await expect(card(page)).toHaveCount(0);
});

test("运行跨刷新与关闭按真实时间恢复，跨到期只结算一次并暂停", async ({ page, context }) => {
  await setTime(page, baseTime);
  await openExample(page); await action(page, "开始");
  await setTime(page, baseTime + 60_000); await page.reload();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("24:00");
  const url = page.url(); await page.close();
  const reopened = await context.newPage(); await setTime(reopened, baseTime + 120_000); await reopened.goto(url);
  await expect(frame(reopened).locator("#timeDisplay")).toHaveText("23:00");
  await reopened.goto("about:blank"); await setTime(reopened, baseTime + 10 * 60 * 60_000); await reopened.goto(url);
  await expect(frame(reopened).locator("#status")).toHaveText("已保存");
  await expect(frame(reopened).locator("#modeLabel")).toHaveText("休息");
  await expect(frame(reopened).locator("#timeDisplay")).toHaveText("05:00");
  await expect(frame(reopened).locator("#countDisplay")).toHaveText("已完成专注 1 次");
  await expect(frame(reopened).getByRole("button", { name: "开始", exact: true })).toBeEnabled();
  await reopened.reload(); await expect(frame(reopened).locator("#countDisplay")).toHaveText("已完成专注 1 次");
  await action(reopened, "开始");
  await reopened.goto("about:blank"); await setTime(reopened, baseTime + 20 * 60 * 60_000); await reopened.goto(url);
  await expect(frame(reopened).locator("#modeLabel")).toHaveText("专注");
  await expect(frame(reopened).locator("#timeDisplay")).toHaveText("25:00");
  await expect(frame(reopened).locator("#countDisplay")).toHaveText("已完成专注 1 次");
});

test("暂停、继续与重置保留统计未知字段，旧计时记录兼容", async ({ page }) => {
  await setTime(page, baseTime); await openExample(page);
  const id = new URL(page.url()).searchParams.get("project")!;
  // A synthetic historical record is an input, never a fabricated timer result.
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => { const tx = db.transaction("applicationData", "readwrite"); tx.objectStore("applicationData").put({ projectId: id, state: { mode: "focus", remaining: 900, running: true, completedFocusCount: 7, custom: { keep: ["未知"] } } }); tx.oncomplete = () => resolve(); }); db.close();
  }, id);
  await page.reload(); await expect(frame(page).locator("#status")).toHaveText("已保存");
  await setTime(page, baseTime + 60_000); await action(page, "暂停");
  await expect(frame(page).locator("#timeDisplay")).toHaveText("14:00");
  await setTime(page, baseTime + 3600_000); await page.reload();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("14:00");
  await action(page, "开始"); await setTime(page, baseTime + 3660_000); await page.reload();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("13:00");
  await action(page, "重置"); await page.reload();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("25:00");
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 7 次");
  const state = (await database(page)).data.find(d => d.projectId === id)!.state!;
  expect(state.custom).toEqual({ keep: ["未知"] }); expect(state.running).toBe(false);
});

test("结算写入失败不多计数，显式重试成功后重开幂等", async ({ page }) => {
  await setTime(page, baseTime); await openExample(page); await action(page, "开始");
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const r = put.apply(this, args);
      if (this.name === "applicationData") r.addEventListener("success", () => this.transaction.abort());
      return r;
    };
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
  });
  const url = page.url(); await page.goto("about:blank"); await setTime(page, baseTime + 3600_000); await page.goto(url);
  await expect(frame(page).locator("#status")).toContainText("保存失败");
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 0 次");
  await frame(page).getByRole("button", { name: "重试", exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toContainText("保存失败");
  const id = new URL(page.url()).searchParams.get("project");
  expect((await database(page)).data.find(d => d.projectId === id)!.state!.completedFocusCount).toBe(0);
  await page.evaluate(() => Reflect.get(window, "restorePut")());
  await action(page, "重试");
  await page.reload(); await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 1 次");
  await expect(frame(page).getByRole("button", { name: "开始", exact: true })).toBeEnabled();
});

test("番茄钟读取失败不能写，恢复后原数据保留；开始保存失败可重试", async ({ page }) => {
  await openExample(page); await action(page, "开始"); await action(page, "暂停");
  const before = await database(page);
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) { if (this.name === "applicationData") throw new DOMException("read failure"); return get.apply(this, args); };
    Object.assign(window, { restoreGet: () => { IDBObjectStore.prototype.get = get; } });
  });
  await page.reload(); await expect(frame(page).locator("#status")).toContainText("读取失败");
  await expect(frame(page).locator("#toggleBtn")).toBeDisabled();
  expect(await database(page)).toEqual(before);
  await page.evaluate(() => Reflect.get(window, "restoreGet")());
  await frame(page).getByRole("button", { name: "重试", exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toHaveText("已读取");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException("full"); };
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
  });
  await frame(page).getByRole("button", { name: "开始", exact: true }).press("Enter");
  await expect(frame(page).locator("#status")).toContainText("保存失败");
  expect(await database(page)).toEqual(before);
  await page.evaluate(() => Reflect.get(window, "restorePut")()); await action(page, "重试");
});

test("前台按原规则切换专注与休息，展示与输入不重置计时", async ({ page }) => {
  await setTime(page, baseTime); await openExample(page); await action(page, "开始");
  await page.getByLabel("追加修改需求", { exact: true }).fill("保留输入");
  await page.getByText("项目详情与保存范围", { exact: true }).click();
  await page.getByText("示例交付说明", { exact: true }).click();
  await setTime(page, baseTime + 1500_000);
  await expect(frame(page).locator("#modeLabel")).toHaveText("休息");
  await expect(frame(page).getByRole("button", { name: "暂停", exact: true })).toBeEnabled();
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 1 次");
  await expect(page.getByLabel("追加修改需求", { exact: true })).toHaveValue("保留输入");
  await setTime(page, baseTime + 1800_000);
  await expect(frame(page).locator("#modeLabel")).toHaveText("专注");
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 1 次");
});

test("示例修改携带完整基线无业务数据，试用隔离，采用只更新代码与记录且重开零调用", async ({ page }) => {
  await setTime(page, baseTime); await openExample(page); await action(page, "开始");
  await setTime(page, baseTime + 60_000); await action(page, "暂停");
  const before = await database(page), id = before.projects[0].id;
  let calls = 0;
  await page.route("**/api/generate", async route => {
    calls++; const body = route.request().postDataJSON();
    expect(body.projectId).toBe(id); expect(body.requirement).toContain("不重复计数");
    expect(body.baseHtml).toContain("deadlineAt");
    expect(Object.keys(body).sort()).toEqual(["baseDataIssues", "baseHtml", "context", "modification", "projectId", "requirement"]);
    await fulfillGeneration(route, { json: { html: body.baseHtml.replace("<h1>专注番茄钟</h1>", "<h1>我的专注番茄钟</h1>"), model: "synthetic", durationMs: 1, generatedAt: "modified" } });
  });
  await page.getByLabel("追加修改需求", { exact: true }).fill("标题改成我的专注番茄钟");
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect(frame(page).getByRole("heading", { name: "我的专注番茄钟" })).toBeVisible();
  await action(page, "重置");
  expect((await database(page)).data).toEqual(before.data);
  await page.getByRole("button", { name: "采用修改", exact: true }).click();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("24:00");
  await expect(page.getByText("第 1 轮候选 · 等待采用")).toHaveCount(0);
  const adopted = await database(page);
  expect(adopted.data).toEqual(before.data);
  expect(adopted.projects[0].exampleSource).toEqual(before.projects[0].exampleSource);
  expect(adopted.projects[0].modificationRecords).toHaveLength(1);
  await page.reload();
  await expect(frame(page).getByRole("heading", { name: "我的专注番茄钟" })).toBeVisible();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("24:00");
  expect(calls).toBe(1);
});


test("已有项目的初始化标记写入失败仍显示旧项目与数据", async ({ page }) => {
  await seedOld(page);
  const before = await database(page);
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("readonly"); };
  });
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("当前无法保证保存与恢复");
  await expect(page.getByRole("region", { name: "已有项目" }).getByRole("button", { name: /旧项目/ })).toBeVisible();
  expect(await database(page)).toEqual(before);
});

test("暂停与重置保存失败不覆盖原状态，重试后按实际时间暂停与保留统计", async ({ page }) => {
  await setTime(page, baseTime); await openExample(page); await action(page, "开始");
  for (const name of ["暂停", "重置"]) {
    const before = await database(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException("full"); };
      Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
    });
    await setTime(page, baseTime + 60_000);
    await frame(page).getByRole("button", { name, exact: true }).press("Enter");
    await expect(frame(page).locator("#status")).toContainText("保存失败");
    expect(await database(page)).toEqual(before);
    await page.evaluate(() => Reflect.get(window, "restorePut")());
    await action(page, "重试");
    await expect(frame(page).locator("#timeDisplay")).toHaveText(name === "暂停" ? "24:00" : "25:00");
  }
});

test("已保存且修改过的旧示例显示助手消息，不迁移或覆盖代码与数据", async ({ page }, info) => {
  await page.goto("/?project=legacy-example");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  const html = await (await page.request.get("/examples/pomodoro-v1.html")).text();
  await page.evaluate(async html => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["projects", "applicationData"], "readwrite");
      tx.objectStore("projects").put({
        id: "legacy-example", title: "示例 · 专注番茄钟", requirement: "已有示例功能基线", updatedAt: "2026-10-02T01:00:00Z",
        exampleSource: { kind: "builtin-example", templateId: "focus-pomodoro", version: 1, sourceCodeHash: "a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489", codeHash: "d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f" },
        result: { html: html.replace("<h1>专注番茄钟</h1>", "<h1>保留我的标题</h1>"), model: "historical-fixture", durationMs: 1, generatedAt: "legacy" },
        modificationRecords: [{ id: "saved-change", adoptedAt: "2026-10-02T01:00:00Z", requests: ["保留我的标题"], summary: "原有修改记录" }],
      });
      tx.objectStore("applicationData").put({ projectId: "legacy-example", state: { remaining: 987, running: false, completedFocusCount: 4, custom: { keep: true } } });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); db.close();
  }, html);
  const before = await database(page);
  let requests = 0; page.on("request", r => { if (r.url().includes("/api/generate")) requests++; });
  await page.reload();
  const conversation = page.getByRole("region", { name: "示例项目记录" });
  await expect(conversation.getByRole("heading", { name: "助手 示例项目" })).toBeVisible();
  await expect(frame(page).getByRole("heading", { name: "保留我的标题" })).toBeVisible();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("16:27");
  await expect(frame(page).locator("#countDisplay")).toHaveText("已完成专注 4 次");
  await page.getByLabel("追加修改需求", { exact: true }).fill("尚未提交的需求");
  await conversation.getByText("示例交付说明", { exact: true }).click();
  await expect(page.getByLabel("追加修改需求", { exact: true })).toHaveValue("尚未提交的需求");
  await expect(page.getByText("原有修改记录", { exact: true })).toBeVisible();
  expect(await database(page)).toEqual(before);
  await page.screenshot({ path: info.outputPath("existing-example-conversation.png") });
  await page.reload();
  await expect(conversation.getByRole("heading", { name: "助手 示例项目" })).toBeVisible();
  await expect(frame(page).locator("#timeDisplay")).toHaveText("16:27");
  expect(await database(page)).toEqual(before); expect(requests).toBe(0);
});
