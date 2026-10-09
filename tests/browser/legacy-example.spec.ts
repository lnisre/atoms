import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fulfillGeneration } from "./team-fixture";

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
  await page.goto("/?project=legacy-timer");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("找不到该项目");
  const html = readFileSync("public/examples/pomodoro-v1.html", "utf8");
  await page.evaluate(async html => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("atoms-projects", 1); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>(resolve => {
      const tx = db.transaction(["projects", "applicationData"], "readwrite");
      tx.objectStore("projects").put({ id: "legacy-timer", title: "示例 · 专注番茄钟", requirement: "旧番茄钟不重复计数", updatedAt: "2026-10-02", result: { html, model: "historical", generatedAt: "2026-10-02", durationMs: 0 }, exampleSource: { kind: "builtin-example", templateId: "focus-pomodoro", version: 1, sourceCodeHash: "a6c8df564b6088fc986ae137286e2b039d0cb9c10ab678d17a56bccd11dfc489", codeHash: "d1d6944ff3eda19b7f5150e9895cacc71579313be13e1e40232153f5b747871f" } });
      tx.objectStore("applicationData").put({ projectId: "$atoms:workspace:first-visit", completed: true });
      tx.oncomplete = () => resolve();
    }); db.close();
  }, html);
  await page.reload();
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
  // Use the same browser network path as initialization (including host proxy).
  const html = await page.evaluate(async () => {
    const response = await fetch("/examples/pomodoro-v1.html", { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("示例素材读取失败");
    return response.text();
  });
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
