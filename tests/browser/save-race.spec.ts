import { fulfillGeneration } from "./team-fixture";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Unmodified model output that originally lost the second edit on immediate close.
const html = readFileSync("docs/verification/assets/issue-3/production-todo.html", "utf8");

test("真实旧产物保存时禁止新修改，下一次修改确认后立即关闭可恢复", async ({ page, context }) => {
  let generations = 0;
  context.on("request", request => { if (request.url().endsWith("/api/generate")) generations++; });
  await page.route("**/api/generate", route => fulfillGeneration(route, { json: {
    html, model: "real-artifact-replay", durationMs: 1, generatedAt: "test",
  } }));
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("连续操作保存回归");
  await page.getByRole("button", { name: "开始生成" }).click();
  const f = page.frameLocator("iframe");
  await expect(f.getByLabel("新任务描述")).toBeEnabled();
  // Hold the real transaction until the test has attempted another edit. No timing guess.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let held = false;
    const control = window as typeof window & { releaseSave?: boolean };
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === "readwrite" && tx.objectStoreNames.contains("applicationData") && !held) {
        held = true;
        const store = tx.objectStore("applicationData");
        const pump = () => {
          store.get("__test_keepalive__").onsuccess = () => { if (!control.releaseSave) pump(); };
        };
        pump();
      }
      return tx;
    };
  });
  await f.getByLabel("新任务描述").fill("第一条已提交");
  await f.getByRole("button", { name: "添加", exact: true }).click();
  await expect(f.locator("body")).toHaveAttribute("inert", "");
  await expect(page.locator(".data-status")).toContainText("暂时无法编辑");
  // Synthetic events also cover handlers in modal dialogs, which can escape inert.
  await f.locator("#taskInput").evaluate((input: HTMLInputElement) => { input.value = "保存中不可修改"; });
  await f.locator("#addBtn").dispatchEvent("click");
  await f.locator("#taskInput").dispatchEvent("keydown", { key: "Enter" });
  await expect(f.getByText("保存中不可修改", { exact: true })).toHaveCount(0);
  await expect(f.locator("#saveStatus")).not.toHaveText("已保存");
  await page.evaluate(() => { (window as typeof window & { releaseSave: boolean }).releaseSave = true; });
  await expect(f.locator("#saveStatus")).toHaveText("已保存");
  await expect(f.locator("body")).not.toHaveAttribute("inert", "");
  await f.getByLabel("新任务描述").fill("第二条最新修改");
  const url = page.url();
  let closed!: () => void;
  const close = new Promise<void>(resolve => { closed = resolve; });
  await page.exposeFunction("closeAtSaved", async () => { await page.close(); closed(); });
  await page.evaluate(() => {
    addEventListener("message", event => {
      if (event.data?.type === "test:saved") void (window as typeof window & { closeAtSaved: () => Promise<void> }).closeAtSaved();
    });
  });
  await f.locator("#saveStatus").evaluate(status => {
    const observer = new MutationObserver(() => {
      if (status.textContent === "已保存") {
        observer.disconnect();
        parent.postMessage({ type: "test:saved" }, "*");
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  });
  // The page deliberately closes during this click's navigation bookkeeping.
  await f.getByRole("button", { name: "添加", exact: true }).click({ noWaitAfter: true });
  await close;
  const reopened = await context.newPage();
  await reopened.goto(url);
  const rf = reopened.frameLocator("iframe");
  await expect(rf.getByText("第一条已提交", { exact: true })).toBeVisible();
  await expect(rf.getByText("第二条最新修改", { exact: true })).toBeVisible();
  await expect(rf.getByText("保存中不可修改", { exact: true })).toHaveCount(0);
  expect(generations).toBe(1);
});
