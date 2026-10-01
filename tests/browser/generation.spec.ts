import { fulfillGeneration } from "./team-fixture";
import { expect, test } from "@playwright/test";

// These fixtures test platform behavior only. Real-model acceptance is recorded separately.
const html = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif}</style></head><body><button id="count">0</button><script>let n=0;document.querySelector('#count').onclick=e=>e.target.textContent=++n;</script></body></html>`;
const result = {
  html,
  model: "test-fixture",
  durationMs: 1200,
  generatedAt: "2026-09-29T08:00:00Z",
};

test("需求留在工作台，等待结束后运行隔离预览并保存项目", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generate", async (route) => {
    expect(route.request().postDataJSON().requirement).toBe("做一个计数器");
    await gate;
    await fulfillGeneration(route, { json: result });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始生成" })).toBeDisabled();
  await page.getByLabel("你想做什么？").fill("做一个计数器");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(
    page.getByRole("heading", { name: "正在生成应用" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "新建项目" })).toBeDisabled();
  release();
  await expect(page.getByRole("heading", { name: "代码已生成" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  // Use keyboard activation for the generation/iframe contract; first pointer
  // delivery can be lost by Chrome (event evidence in issue-10 verification).
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "0", exact: true })
    .press("Enter");
  await expect(
    page.frameLocator("iframe").getByRole("button", { name: "1", exact: true }),
  ).toBeVisible();
  const appFrame = page.frames().find((frame) => frame !== page.mainFrame())!;
  expect(
    await appFrame.evaluate(() => {
      try {
        return !!parent.document.body;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  await expect(page.getByText("项目已保存", { exact: true })).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toHaveCount(0);
});

test("失败后保留需求并允许手动重新生成", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/generate", async (route) => {
    attempts += 1;
    await fulfillGeneration(route,
      attempts === 1
        ? {
            status: 502,
            json: { error: "模型服务暂时不可用，请稍后手动重试。" },
          }
        : { json: result },
    );
  });
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("计数器失败验证");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "模型服务暂时不可用",
  );
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect(page.getByRole("heading", { name: "代码已生成" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("浏览器等待超时后结束等待并提供重试", async ({ page }) => {
  await page.route("**/api/generate", () => {});
  await page.goto("/");
  // Wait for hydration and IndexedDB initialization before taking over timers.
  await expect(page.getByRole("heading", { name: "还没有已保存的项目" })).toBeVisible();
  await page.clock.install();
  await page.getByLabel("你想做什么？").fill("超时验证");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(
    page.getByRole("heading", { name: "正在生成应用" }),
  ).toBeVisible();
  await page.clock.fastForward(241_000);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "等待超时",
  );
  await expect(
    page.getByRole("button", { name: "重新生成", exact: true }),
  ).toBeEnabled();
});

test("生成应用运行异常时提示而非宣称验证通过", async ({ page }) => {
  await page.route("**/api/generate", (route) =>
    fulfillGeneration(route, {
      json: {
        ...result,
        html: html.replace(
          "let n=0;",
          "throw new Error('runtime failure');let n=0;",
        ),
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("运行异常验证");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "运行错误",
  );
  await expect(
    page.getByRole("button", { name: "重新生成", exact: true }),
  ).toBeVisible();
});

test("手机首页不横向溢出，示例只填入需求", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "待办清单" }).click();
  await expect(page.getByLabel("你想做什么？")).toHaveValue(/添加、完成、删除/);
  await expect(page.getByRole("button", { name: "开始生成" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
