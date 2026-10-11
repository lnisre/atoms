import { expect, test } from "@playwright/test";
import { fixture, generate, ready } from "../helpers/cloud-browser-fixture";
// Current account UI with explicit synthetic Auth/BFF/provider boundary.
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
    const store=await fixture();await store.connect(page.context());store.render(()=>html);
    await generate(page);await expect(ready(page)).toBeVisible();
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
    // This checks bridge/commit behavior, not compositor hit testing. Passive event
    // probes recorded occasional first pointer clicks landing on the outer iframe
    // (see issue-10 verification); keyboard activation keeps this seam deterministic.
    await frame.locator("#action").press("Enter");
    await expect(frame.locator("#action")).toHaveText("1");
    await expect(page.getByText("应用数据已保存到云端",{exact:true})).toBeVisible();
    await page.reload();
    await expect(frame.locator("#action")).toHaveText("1");
    await frame.locator("#error").press("Enter");
    await expect(page.locator(".preview-error")).toContainText("预览出现运行错误");
  });
}

test("云端读取不完整 HTML 时明确显示装配失败且不运行 iframe", async ({ page }) => {
  const store=await fixture();await store.connect(page.context());
  await generate(page);await expect(ready(page)).toBeVisible();
  const row=[...store.rows.values()][0];
  row.cloud.project.result.html="<!DOCTYPE html><html><!-- <head> --><body>不完整结果</body></html>";
  await page.reload();
  await expect(page.locator(".data-status")).toContainText("无法装配预览");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".data-status")).toContainText("无法装配预览");
  await expect(page.locator("iframe")).toHaveCount(0);
});
