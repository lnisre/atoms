import { expect, test } from "@playwright/test";
import { POST } from "../../src/app/api/generate/route";

// Controlled provider output, passed through the real route handler before UI delivery.
// No real model call and no production credentials are used.
for (const prefix of ["", "<!-- example <head> -->", '<!-- <head> --><!----><!-- <body> -->']) {
  test(`真实 head 装配、数据保存恢复和运行异常反馈：${prefix || "普通完整 HTML"}`, async ({ page }) => {
    const html = `<!DOCTYPE html>${prefix}<html lang="zh"><head data-example=">">
<title>装配回归</title><script>window.bridgeAtFirstScript=typeof window.atoms;</script>
</head><body><button id="action" disabled>0</button><button id="error">触发异常</button><script>
let state=0; const action=document.getElementById('action');
atoms.loadState().then(value=>{state=value??0;action.textContent=String(state);action.disabled=false;});
action.onclick=async()=>{state++;await atoms.saveState(state);action.textContent=String(state);};
document.getElementById('error').onclick=()=>{throw new Error('controlled runtime failure');};
</script></body></html>`;
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    let result;
    try {
      process.env.DEEPSEEK_API_KEY = "controlled-test-key";
      globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] });
      const response = await POST(new Request("http://localhost/api/generate", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requirement: "装配回归" }),
      }));
      expect(response.status).toBe(200);
      result = await response.json();
      expect(result.html).toBe(html);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalKey;
    }
    await page.route("**/api/generate", route => route.fulfill({ json: result }));
    await page.goto("/");
    await page.getByLabel("你想做什么？").fill("平台装配回归");
    await page.getByRole("button", { name: "开始生成" }).click();
    const frame = page.frameLocator("iframe");
    await expect(frame.locator("#action")).toBeEnabled();
    expect(await frame.locator("body").evaluate(() => ({
      bridge: (window as unknown as { bridgeAtFirstScript: string }).bridgeAtFirstScript,
      csp: document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
      first: document.head.firstElementChild?.tagName,
      headAttribute: document.head.getAttribute("data-example"),
    }))).toEqual({ bridge: "object", csp: 1, first: "META", headAttribute: ">" });
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
    expect(await frame.locator("body").evaluate(async () => {
      try { await fetch("https://example.com/blocked-by-platform"); return false; }
      catch { return true; }
    })).toBe(true);
    await frame.locator("#action").click();
    await expect(frame.locator("#action")).toHaveText("1");
    await expect(page.locator(".data-status")).toHaveText("应用数据已保存");
    await page.reload();
    await expect(frame.locator("#action")).toHaveText("1");
    await frame.locator("#error").click();
    await expect(page.locator(".preview-error")).toContainText("预览出现运行错误");
  });
}

test("恢复旧的不完整 HTML 时明确显示装配失败且不运行 iframe", async ({ page }) => {
  await page.route("**/api/generate", route => route.fulfill({ json: {
    html: "<!DOCTYPE html><html><!-- <head> --><body>旧的不完整结果</body></html>",
    model: "controlled-legacy-fixture", generatedAt: new Date().toISOString(), durationMs: 1,
  } }));
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("旧项目装配失败回归");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.locator(".data-status")).toContainText("无法装配预览");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".data-status")).toContainText("无法装配预览");
  await expect(page.locator("iframe")).toHaveCount(0);
});
