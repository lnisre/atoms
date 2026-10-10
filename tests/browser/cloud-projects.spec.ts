import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { builtinExampleFromHtml, EXAMPLE_STATE } from "../../src/lib/builtin-example";
import type { CloudProject, CommitReceipt } from "../../src/lib/cloud-projects/contract";

// Synthetic BFF responses exercise the real UI/iframe/failed-save retention.
// Real PG SQL evidence is separate; these fixtures are not JWT/RLS acceptance.
async function fixture() {
  const template = await builtinExampleFromHtml(readFileSync("public/examples/tip-calculator-v1.html", "utf8"));
  const records = new Map<string, { owner: string; cloud: CloudProject }>();
  const operations = new Map<string, CommitReceipt>();
  let lostCopy = false, lostSave = false, failRead = false, failProjectRead = false;
  let gate: Promise<void> | undefined, release = () => {};
  let projectGate: Promise<void> | undefined, releaseProject = () => {};
  let modelCalls = 0, copyCalls = 0, saveCalls = 0;
  const saveBodies: unknown[] = [], copyBodies: unknown[] = [];
  async function connect(context: BrowserContext, owner: string, signedIn = true) {
    let authenticated = signedIn;
    await context.route("**/api/auth/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/code")) return route.fulfill({ json: { sent: true, retryAfter: 60 } });
      if (path.endsWith("/logout")) { authenticated = false; return route.fulfill({ json: { signedOut: true } }); }
      if (path.endsWith("/verify")) authenticated = true;
      return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { account: { id: owner, email: `${owner}@example.invalid` } } : { error: "请先登录" } });
    });
    await context.route("**/api/generate**", route => { modelCalls++; return route.fulfill({ status: 500, json: { error: "unexpected model call" } }); });
    await context.route("**/api/projects**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!authenticated || request.headers()["x-atoms-account"] !== owner) return route.fulfill({ status: 401, json: { code: "unauthenticated", error: "请重新登录原账号" } });
      if (url.pathname === "/api/projects") return route.fulfill({ json: [...records.values()].filter(row => row.owner === owner).map(row => row.cloud.project) });
      if (url.pathname === "/api/projects/example") {
        copyCalls++; const body = request.postDataJSON(); copyBodies.push(body);
        const key = owner + ":" + body.operationId;
        let receipt = operations.get(key);
        if (!receipt) {
          const project = { ...structuredClone(template), id: crypto.randomUUID() };
          records.set(project.id, { owner, cloud: { project, version: { code: 1, data: 1 }, state: structuredClone(EXAMPLE_STATE), hasData: true } });
          receipt = { projectId: project.id, version: { code: 1, data: 1 }, updatedAt: project.updatedAt }; operations.set(key, receipt);
        }
        if (lostCopy) { lostCopy = false; return route.abort("failed"); }
        return route.fulfill({ json: receipt });
      }
      const id = url.pathname.split("/")[3], record = records.get(id);
      if (!record || record.owner !== owner) return route.fulfill({ status: 404, json: { code: "PT404", error: "找不到该项目，或当前账号没有访问权限。" } });
      if (url.pathname.endsWith("/data")) {
        if (request.method() === "GET") {
          if (failRead) return route.fulfill({ status: 503, json: { code: "unavailable", error: "数据读取失败" } });
          return route.fulfill({ json: { state: record.cloud.state, version: record.cloud.version, hasData: true } });
        }
        saveCalls++; const body = request.postDataJSON(); saveBodies.push(body);
        if (gate) await gate;
        const key = owner + ":" + body.operationId;
        let receipt = operations.get(key);
        if (!receipt) {
          if (JSON.stringify(body.expected) !== JSON.stringify(record.cloud.version)) return route.fulfill({ status: 409, json: { code: "conflict", error: "云端已有更新，已拒绝覆盖。当前内容仍保留，可下载副本或重新载入。" } });
          record.cloud.state = body.state; record.cloud.version.data++;
          record.cloud.project.updatedAt = new Date().toISOString();
          receipt = { projectId: id, version: { ...record.cloud.version }, updatedAt: record.cloud.project.updatedAt }; operations.set(key, receipt);
        }
        if (lostSave) { lostSave = false; return route.abort("failed"); }
        return route.fulfill({ json: receipt });
      }
      if (projectGate) await projectGate;
      if (failProjectRead) return route.fulfill({ status: 503, json: { error: "项目读取暂时失败，原页面保留。" } });
      return route.fulfill({ json: record.cloud });
    });
  }
  return { connect, records, copyBodies, saveBodies,
    loseCopy: () => { lostCopy = true; }, loseSave: () => { lostSave = true; },
    readFailure: (value: boolean) => { failRead = value; }, projectReadFailure: (value: boolean) => { failProjectRead = value; },
    holdSave: () => { gate = new Promise<void>(resolve => { release = resolve; }); },
    holdProject: () => { projectGate = new Promise<void>(resolve => { releaseProject = resolve; }); },
    releaseProject: () => { releaseProject(); projectGate = undefined; },
    releaseSave: () => { release(); gate = undefined; },
    stats: () => ({ modelCalls, copyCalls, saveCalls }) };
}
async function create(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "查看只读示例" }).click();
  await page.getByRole("button", { name: "保存此示例到我的项目" }).click();
}
const frame = (page: Page) => page.frameLocator('iframe[title="生成的应用"]');
const saved = (page: Page) => page.getByText("应用数据已保存到云端", { exact: true });
const retry = (page: Page) => page.getByRole("button", { name: "重试原保存" });
async function download(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载未保存副本", exact: true }).click();
  const file = await waiting; expect(file.suggestedFilename()).toContain("未保存副本");
  return JSON.parse(readFileSync((await file.path())!, "utf8"));
}

test("explicit guest copy continues once; lost response retries same operation; independent browser restores and another owner is denied", async ({ page, context, browser }) => {
  const store = await fixture(); await store.connect(context, "owner-a", false); store.loseCopy();
  await page.addInitScript(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = (name, version) => { if (name === "atoms-projects") throw new Error("must not touch old project DB"); return open(name, version); }; });
  await create(page);
  await page.getByLabel("邮箱地址", { exact: true }).fill("owner-a@example.invalid"); await page.getByRole("button", { name: "发送验证码", exact: true }).click();
  await page.getByLabel("6 位验证码", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "验证并登录" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(retry(page)).toBeEnabled(); expect(store.records.size).toBe(1);
  await retry(page).click(); await expect(saved(page)).toBeVisible(); expect(store.records.size).toBe(1);
  expect(store.copyBodies[0]).toEqual(store.copyBodies[1]);
  await frame(page).getByLabel("账单金额（元）").fill("80"); await expect(saved(page)).toBeVisible(); await expect(frame(page).locator("#perPersonVal")).toHaveText("¥21.00");
  const url = page.url(), otherDevice = await browser.newContext(), stranger = await browser.newContext();
  try {
    await store.connect(otherDevice, "owner-a"); const second = await otherDevice.newPage(); await second.goto(url);
    await expect(frame(second).getByLabel("账单金额（元）")).toHaveValue("80"); await expect(saved(second)).toBeVisible();
    await second.getByRole("button", { name: "查看代码", exact: true }).click(); await expect(second.getByRole("button", { name: "index.html", exact: true })).toBeVisible();
    await store.connect(stranger, "owner-b"); const third = await stranger.newPage(); await third.goto(url);
    await expect(third.getByRole("alert").filter({ hasText: "没有访问权限" })).toBeVisible(); await expect(third.locator("iframe")).toHaveCount(0);
    expect(store.stats().modelCalls).toBe(0);
  } finally { await otherDevice.close(); await stranger.close(); }
});

test("saving waits for acknowledgment, failed payload downloads from platform, replay restores submitted values", async ({ page, context }, info) => {
  const store = await fixture(); await store.connect(context, "owner-a"); await create(page); await expect(saved(page)).toBeVisible();
  store.holdSave(); store.loseSave();
  await frame(page).getByLabel("账单金额（元）").fill("120");
  await expect(page.getByText("应用数据正在保存…云端提交后才会确认", { exact: true })).toBeVisible(); await expect(saved(page)).toHaveCount(0);
  expect([...store.records.values()][0].cloud.state).toEqual(EXAMPLE_STATE);
  store.releaseSave(); await expect(retry(page)).toBeEnabled();
  const copy = await download(page); expect(copy.savedToCloud).toBe(false); expect(copy.importSupported).toBe(false); expect(copy.businessState.bill).toBe(120); expect(copy.code).toContain("小费");
  await page.screenshot({ path: info.outputPath("retained-save.png"), fullPage: true });
  const before = [...store.records.values()][0].cloud.version.data;
  await retry(page).click(); await expect(saved(page)).toBeVisible(); await expect(frame(page).getByLabel("账单金额（元）")).toHaveValue("120");
  expect([...store.records.values()][0].cloud.version.data).toBe(before); expect(store.saveBodies[0]).toEqual(store.saveBodies[1]);
  await page.getByRole("button", { name: "退出登录" }).click(); await expect(page.locator("iframe")).toHaveCount(0); expect(store.records.size).toBe(1);
});

test("two stale pages conflict; download/cancel/reload protect failed content, read failure never triggers a write", async ({ page, context, browser }, info) => {
  const store = await fixture(); await store.connect(context, "owner-a"); await create(page); await expect(saved(page)).toBeVisible();
  const secondContext = await browser.newContext();
  try {
    await store.connect(secondContext, "owner-a"); const second = await secondContext.newPage(); await second.goto(page.url()); await expect(saved(second)).toBeVisible();
    await frame(page).getByLabel("账单金额（元）").fill("80"); await expect(saved(page)).toBeVisible();
    await frame(second).getByLabel("账单金额（元）").fill("90"); await expect(second.getByRole("alert").filter({ hasText: "云端已有更新" })).toBeVisible();
    expect((await download(second)).businessState.bill).toBe(90);
    const reload = second.getByRole("button", { name: "重新载入云端版本", exact: true });
    await reload.click(); await expect(second.getByRole("dialog")).toBeVisible(); await second.getByRole("button", { name: "留在页面" }).click(); await expect(retry(second)).toBeVisible();
    store.projectReadFailure(true); await reload.click(); await second.getByRole("button", { name: "仍要重新载入" }).click();
    await expect(second.getByRole("alert").filter({ hasText: "原页面保留" })).toBeVisible(); expect((await download(second)).businessState.bill).toBe(90);
    store.projectReadFailure(false); await reload.click(); await second.getByRole("button", { name: "仍要重新载入" }).click();
    await expect(frame(second).getByLabel("账单金额（元）")).toHaveValue("80"); await expect(retry(second)).toHaveCount(0);
    store.readFailure(true); const writes = store.stats().saveCalls; await second.reload();
    await expect(second.getByRole("alert").filter({ hasText: "数据读取失败" })).toBeVisible(); await expect(frame(second).getByLabel("账单金额（元）")).toBeDisabled();
    expect(store.stats().saveCalls).toBe(writes);
    await second.screenshot({ path: info.outputPath("read-failed.png"), fullPage: true });
  } finally { await secondContext.close(); }
});


test("a new unsaved edit while reload is reading cannot be silently discarded", async ({ page, context }) => {
  const store = await fixture(); await store.connect(context, "owner-a"); await create(page); await expect(saved(page)).toBeVisible();
  store.holdProject(); store.holdSave();
  await page.getByRole("button", { name: "重新载入云端版本", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "正在读取云端项目" })).toBeVisible();
  await frame(page).getByLabel("账单金额（元）").fill("140");
  await expect(page.getByText("应用数据正在保存…云端提交后才会确认", { exact: true })).toBeVisible();
  store.releaseProject();
  await expect(page.getByRole("alert").filter({ hasText: "新的未确认保存" })).toBeVisible();
  expect((await download(page)).businessState.bill).toBe(140);
  store.releaseSave(); await expect(saved(page)).toBeVisible();
});
