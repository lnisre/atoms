# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: preview-document.spec.ts >> 真实 head 装配、数据保存恢复和运行异常反馈：<!-- example <head> -->
- Location: tests/browser/preview-document.spec.ts:7:7

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('iframe').contentFrame().locator('#action')
Expected: "1"
Received: "0"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('iframe').contentFrame().locator('#action') with timeout 5000ms
  - waiting for locator('iframe').contentFrame().locator('#action')
    14 × locator resolved to <button id="action">0</button>
       - unexpected value "0"

```

```yaml
- button "0"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { POST } from "../../src/app/api/generate/route";
  3  | 
  4  | // Controlled provider output, passed through the real route handler before UI delivery.
  5  | // No real model call and no production credentials are used.
  6  | for (const prefix of ["", "<!-- example <head> -->", '<!-- <head> --><!----><!-- <body> -->']) {
  7  |   test(`真实 head 装配、数据保存恢复和运行异常反馈：${prefix || "普通完整 HTML"}`, async ({ page }) => {
  8  |     const html = `<!DOCTYPE html>${prefix}<html lang="zh"><head data-example=">">
  9  | <title>装配回归</title><script>window.bridgeAtFirstScript=typeof window.atoms;</script>
  10 | </head><body><button id="action" disabled>0</button><button id="error">触发异常</button><script>
  11 | let state=0; const action=document.getElementById('action');
  12 | atoms.loadState().then(value=>{state=value??0;action.textContent=String(state);action.disabled=false;});
  13 | action.onclick=async()=>{state++;await atoms.saveState(state);action.textContent=String(state);};
  14 | document.getElementById('error').onclick=()=>{throw new Error('controlled runtime failure');};
  15 | </script></body></html>`;
  16 |     const originalFetch = globalThis.fetch;
  17 |     const originalKey = process.env.DEEPSEEK_API_KEY;
  18 |     let result;
  19 |     try {
  20 |       process.env.DEEPSEEK_API_KEY = "controlled-test-key";
  21 |       globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: html } }] });
  22 |       const response = await POST(new Request("http://localhost/api/generate", {
  23 |         method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requirement: "装配回归" }),
  24 |       }));
  25 |       expect(response.status).toBe(200);
  26 |       result = await response.json();
  27 |       expect(result.html).toBe(html);
  28 |     } finally {
  29 |       globalThis.fetch = originalFetch;
  30 |       if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  31 |       else process.env.DEEPSEEK_API_KEY = originalKey;
  32 |     }
  33 |     await page.route("**/api/generate", route => route.fulfill({ json: result }));
  34 |     await page.goto("/");
  35 |     await page.getByLabel("你想做什么？").fill("平台装配回归");
  36 |     await page.getByRole("button", { name: "开始生成" }).click();
  37 |     const frame = page.frameLocator("iframe");
  38 |     await expect(frame.locator("#action")).toBeEnabled();
  39 |     expect(await frame.locator("body").evaluate(() => ({
  40 |       bridge: (window as unknown as { bridgeAtFirstScript: string }).bridgeAtFirstScript,
  41 |       csp: document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
  42 |       first: document.head.firstElementChild?.tagName,
  43 |       headAttribute: document.head.getAttribute("data-example"),
  44 |     }))).toEqual({ bridge: "object", csp: 1, first: "META", headAttribute: ">" });
  45 |     await expect(page.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  46 |     expect(await frame.locator("body").evaluate(async () => {
  47 |       try { await fetch("https://example.com/blocked-by-platform"); return false; }
  48 |       catch { return true; }
  49 |     })).toBe(true);
  50 |     await frame.locator("#action").click();
> 51 |     await expect(frame.locator("#action")).toHaveText("1");
     |                                            ^ Error: expect(locator).toHaveText(expected) failed
  52 |     await expect(page.locator(".data-status")).toHaveText("应用数据已保存");
  53 |     await page.reload();
  54 |     await expect(frame.locator("#action")).toHaveText("1");
  55 |     await frame.locator("#error").click();
  56 |     await expect(page.locator(".preview-error")).toContainText("预览出现运行错误");
  57 |   });
  58 | }
  59 | 
  60 | test("恢复旧的不完整 HTML 时明确显示装配失败且不运行 iframe", async ({ page }) => {
  61 |   await page.route("**/api/generate", route => route.fulfill({ json: {
  62 |     html: "<!DOCTYPE html><html><!-- <head> --><body>旧的不完整结果</body></html>",
  63 |     model: "controlled-legacy-fixture", generatedAt: new Date().toISOString(), durationMs: 1,
  64 |   } }));
  65 |   await page.goto("/");
  66 |   await page.getByLabel("你想做什么？").fill("旧项目装配失败回归");
  67 |   await page.getByRole("button", { name: "开始生成" }).click();
  68 |   await expect(page.locator(".data-status")).toContainText("无法装配预览");
  69 |   await expect(page.locator("iframe")).toHaveCount(0);
  70 |   await page.reload();
  71 |   await expect(page.locator(".data-status")).toContainText("无法装配预览");
  72 |   await expect(page.locator("iframe")).toHaveCount(0);
  73 | });
  74 | 
```