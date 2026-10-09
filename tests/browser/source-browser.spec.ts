import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fulfillGeneration } from './team-fixture';
import { syntheticSourceVersion } from '../fixtures/source-browser-files';

const html = `<!DOCTYPE html><html><head><title>T1 受控应用</title></head><body>
<h1>T1 受控应用</h1><label>应用草稿<input aria-label="应用草稿" disabled></label>
<button id="save" disabled>保存应用数据</button><button id="start">开始内存计时</button>
<p>已保存：<output id="saved"></output></p><p>计时：<output id="ticks">0</output></p>
<output id="instance"></output><script>
const input=document.querySelector('input'),save=document.querySelector('#save');
document.querySelector('#instance').textContent=crypto.randomUUID();
atoms.loadState().then(s=>{document.querySelector('#saved').textContent=s?.text??'';input.disabled=save.disabled=false});
save.onclick=async()=>{await atoms.saveState({text:input.value});document.querySelector('#saved').textContent=input.value};
let ticks=0;document.querySelector('#start').onclick=()=>{document.querySelector('#start').disabled=true;setInterval(()=>document.querySelector('#ticks').textContent=++ticks,100)};
</script>
${Array.from({ length: 160 }, (_, i) => `<!-- 原始源码第 ${i + 1} 行，不含平台注入 -->`).join('\n')}
</body></html>`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const source = (page: Page, path = 'index.html') => page.getByRole('region', { name: `源码 ${path}`, exact: true });

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('atoms-projects'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const id = new URLSearchParams(location.search).get('project')!;
    const read = (name: string) => new Promise<unknown>((resolve, reject) => { const request = db.transaction(name).objectStore(name).get(id); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error); });
    try { return { project: await read('projects'), data: await read('applicationData') }; } finally { db.close(); }
  });
}
async function within(locator: Locator, width: number, height: number) {
  const box = (await locator.boundingBox())!;
  expect(box).not.toBeNull(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
}
async function leftRight(page: Page, input: Locator) {
  const left = (await input.boundingBox())!, right = (await page.getByRole('region', { name: '项目成果', exact: true }).boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(right.width).toBeGreaterThan(350);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 736, height: 900 }]) {
  test(`真实工作台：原始单文件、状态保全、只读副作用与恢复 ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests: { baseHtml?: string; modification?: string }[] = [];
    await page.route('**/api/generate', route => {
      requests.push(route.request().postDataJSON());
      return fulfillGeneration(route, { json: { html, model: 'T1 SYNTHETIC RESPONSE', durationMs: 1, generatedAt: String(requests.length) } });
    });
    await page.goto('/');
    await page.getByLabel('你想做什么？').fill('T1 源码状态保全');
    await page.getByRole('button', { name: '开始生成', exact: true }).click();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const app = page.frameLocator('iframe');
    await app.getByLabel('应用草稿').fill('已保存的数据');
    await app.getByRole('button', { name: '保存应用数据', exact: true }).press('Enter');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    await app.getByLabel('应用草稿').fill('未提交的应用输入');
    await app.getByRole('button', { name: '开始内存计时', exact: true }).press('Enter');
    await expect.poll(() => app.locator('#ticks').textContent()).not.toBe('0');
    const frame = (await page.locator('iframe').elementHandle())!;
    const instance = await app.locator('#instance').textContent();
    await page.getByLabel('追加修改需求', { exact: true }).fill('未提交的项目级修改');
    const before = await stored(page), ticks = Number(await app.locator('#ticks').textContent());
    await page.getByRole('button', { name: '查看代码', exact: true }).click();
    await expect(source(page)).toBeVisible();
    expect(await source(page).locator('code').textContent()).toBe(html);
    await expect(source(page).locator('script, input, img')).toHaveCount(0);
    await expect(page.getByLabel('当前文件路径')).toHaveText('index.html');
    if (viewport.width === 736) {
      await expect(page.getByRole('navigation', { name: '项目文件' })).toBeHidden();
      await page.getByRole('button', { name: '展开目录' }).click();
    }
    await expect(page.getByRole('navigation', { name: '项目文件' }).getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'index.html', exact: true })).toHaveAttribute('aria-current', 'true');
    await within(page.getByRole('navigation', { name: '项目文件' }), viewport.width, viewport.height);
    await leftRight(page, page.getByLabel('追加修改需求', { exact: true }));
    await page.screenshot({ path: testInfo.outputPath(`source-${viewport.width}.png`) });
    await page.getByRole('button', { name: '收起目录' }).click();
    await source(page).focus();
    // Read the first visible text line's geometry; the gutter is not selectable.
    const sourceBox = (await source(page).locator('code > span').first().boundingBox())!;
    await page.mouse.move(sourceBox.x + 2, sourceBox.y + sourceBox.height / 2); await page.mouse.down();
    await page.mouse.move(sourceBox.x + 130, sourceBox.y + sourceBox.height / 2, { steps: 8 }); await page.mouse.up();
    expect(await page.evaluate(() => getSelection()?.toString())).toBeTruthy();
    await source(page).hover(); await page.mouse.wheel(0, 950);
    await expect.poll(() => source(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    const position = await source(page).evaluate(el => el.scrollTop);
    await expect.poll(async () => Number(await app.locator('#ticks').textContent())).toBeGreaterThan(ticks + 3);
    expect(await stored(page)).toEqual(before);
    expect(requests).toHaveLength(1);
    // Keyboard activates both switches, then Tab reaches the directory control and source.
    await page.getByRole('button', { name: '预览', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(app.getByLabel('应用草稿')).toHaveValue('未提交的应用输入');
    expect(await app.locator('#instance').textContent()).toBe(instance);
    expect(await frame.evaluate(el => el.isConnected)).toBe(true);
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '查看代码', exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '展开目录' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.getByRole('searchbox', { name: '在当前文件中搜索' })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: '复制当前文件', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(source(page)).toBeFocused();
    expect(await source(page).evaluate(el => el.scrollTop)).toBe(position);
    await expect(page.getByLabel('追加修改需求', { exact: true })).toHaveValue('未提交的项目级修改');
    for (const target of [source(page), page.getByLabel('追加修改需求', { exact: true }), page.getByRole('button', { name: '查看代码', exact: true })]) await within(target, viewport.width, viewport.height);
    await page.getByLabel('追加修改需求', { exact: true }).focus(); await expect(page.getByLabel('追加修改需求', { exact: true })).toBeFocused();
    await testInfo.attach('read-only-evidence', { body: JSON.stringify({ sourceHash: hash(html), instance, ticksBefore: ticks, ticksAfter: await app.locator('#ticks').textContent(), scrollTop: position, requestsBefore: 1, requestsAfter: requests.length, before, after: await stored(page) }, null, 2), contentType: 'application/json' });
    // Selecting/reading a file leaves the subsequent modification based on the whole raw result.
    await page.getByRole('button', { name: '生成候选', exact: true }).click();
    await expect(page.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled();
    expect(requests).toHaveLength(2); expect(requests[1].baseHtml).toBe(html);
    await expect(page.getByRole('button', { name: '查看代码', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await within(page.getByRole('button', { name: '采用修改', exact: true }), viewport.width, viewport.height);
    await page.getByRole('button', { name: '放弃本轮修改', exact: true }).click();
    const url = page.url(); await page.reload();
    await expect(page.getByRole('button', { name: '预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(app.locator('#saved')).toHaveText('已保存的数据');
    await page.getByRole('button', { name: '查看代码', exact: true }).click();
    expect(await source(page).locator('code').textContent()).toBe(html);
    expect(await source(page).evaluate(el => el.scrollTop)).toBe(0);
    await page.getByRole('button', { name: '新建项目 / 已有项目', exact: true }).click();
    await page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /T1 源码状态保全/ }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('button', { name: '预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(requests).toHaveLength(2);
  });
}

test('示例项目：唯一文件为原始 HTML，查看期间计时继续且重开零请求', async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route('**/api/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /示例 · 专注番茄钟/ }).click();
  const app = page.frameLocator('iframe');
  await expect(app.locator('#timeDisplay')).toHaveText('25:00');
  await app.getByRole('button', { name: '开始', exact: true }).press('Enter');
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  expect(await source(page).locator('code').textContent()).toBe(await readFile('public/examples/pomodoro-v1.html', 'utf8'));
  await expect.poll(() => app.locator('#timeDisplay').textContent()).not.toBe('25:00');
  await page.screenshot({ path: testInfo.outputPath('example-source.png') });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await app.getByRole('button', { name: '暂停', exact: true }).press('Enter');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '预览', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toEqual([]);
  await testInfo.attach('example-requests', { body: JSON.stringify(requests), contentType: 'application/json' });
});

test('无完整成果：生成期间和失败后入口禁用并解释原因', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/generate', async route => { await gate; await route.fulfill({ status: 500, json: { error: 'T1 受控生成失败' } }); });
  await page.goto('/'); await page.getByLabel('你想做什么？').fill('未完成成果');
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '查看代码', exact: true })).toBeDisabled();
  await expect(page.getByText('尚无完整成果，代码暂不可查看')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: '重新生成', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看代码', exact: true })).toBeDisabled();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('执行阻断：允许只读原始源码，切换视图仍不执行', async ({ page }) => {
  const blockedHtml = '<!DOCTYPE html><html><head></head><body><script>while(true){}</script></body></html>';
  await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html: blockedHtml, model: 'T1 BLOCKED FIXTURE', durationMs: 1, generatedAt: 'blocked' } }));
  await page.goto('/'); await page.getByLabel('你想做什么？').fill('禁止执行的完整源码');
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  expect(await source(page).locator('code').textContent()).toBe(blockedHtml);
  await expect(page.getByRole('button', { name: '使用此版本', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '无条件空循环' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('公开输入上的合成多文件：嵌套、同名、长路径、空文本、键盘与阅读保留', async ({ page }, testInfo) => {
  const bundle = await build({ entryPoints: ['tests/fixtures/source-browser-harness.tsx'], bundle: true, write: false, outdir: 'out', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const unexpected: string[] = [];
  await page.route('http://source-browser.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>' });
    if (path === '/harness.js' || path === '/harness.css') return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css', body: bundle.outputFiles!.find(file => file.path.endsWith(path.endsWith('.js') ? '.js' : '.css'))!.text });
    unexpected.push(path); return route.abort();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://source-browser.test/');
  await page.getByLabel('测试对话输入').fill('合成承载的未提交输入');
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  expect(await source(page).locator('code').textContent()).toBe(syntheticSourceVersion.files[0].text);
  await expect(source(page).locator('script,img,h1')).toHaveCount(0);
  expect(await page.locator('body').getAttribute('data-source-executed')).toBeNull();
  const dir = (path: string) => page.getByRole('button', { name: `目录 ${path}`, exact: true });
  await dir('src').focus(); await page.keyboard.press('Enter');
  await expect(dir('src')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab'); await expect(dir('src/components')).toBeFocused();
  await page.keyboard.press('Space');
  await dir('src/components/header').click();
  await page.getByRole('button', { name: 'src/components/header/index.ts', exact: true }).click();
  await expect(page.getByLabel('当前文件路径')).toHaveText('src/components/header/index.ts');
  await dir('src/components/footer').click();
  await page.getByRole('button', { name: 'src/components/footer/index.ts', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'src/components/footer/index.ts', exact: true })).toHaveAttribute('aria-current', 'true');
  expect(await source(page, 'src/components/footer/index.ts').locator('code').textContent()).toBe(syntheticSourceVersion.files[3].text);
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  await source(page, 'src/main.ts').hover(); await page.mouse.wheel(0, 1300);
  await expect.poll(() => source(page, 'src/main.ts').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const position = await source(page, 'src/main.ts').evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'README.md', exact: true }).click();
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  expect(await source(page, 'src/main.ts').evaluate(el => el.scrollTop)).toBe(position);
  await dir('src/components').click();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  await expect(dir('src')).toHaveAttribute('aria-expanded', 'true');
  await expect(dir('src/components')).toHaveAttribute('aria-expanded', 'false');
  expect(await source(page, 'src/main.ts').evaluate(el => el.scrollTop)).toBe(position);
  await page.screenshot({ path: testInfo.outputPath('synthetic-files-desktop.png') });
  const emptyPath = syntheticSourceVersion.files[4].path;
  for (const path of ['docs', 'docs/这是用于验证项目内完整路径的很长目录', 'docs/这是用于验证项目内完整路径的很长目录/深层说明与空文件']) await dir(path).click();
  await page.getByRole('button', { name: emptyPath, exact: true }).click();
  await expect(page.getByLabel('当前文件路径')).toHaveText(emptyPath);
  expect(await source(page, emptyPath).locator('code').textContent()).toBe('');
  await expect(page.getByText('空文本文件', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 736, height: 900 });
  await expect(page.getByRole('navigation', { name: '项目文件' })).toBeHidden();
  await page.getByRole('button', { name: '展开目录', exact: true }).click();
  await leftRight(page, page.getByLabel('测试对话输入'));
  const tree = (await page.getByRole('navigation', { name: '项目文件' }).boundingBox())!, panel = (await page.getByRole('region', { name: '项目成果', exact: true }).boundingBox())!;
  expect(tree.x).toBeGreaterThanOrEqual(panel.x); expect(tree.x + tree.width).toBeLessThanOrEqual(panel.x + panel.width);
  await page.screenshot({ path: testInfo.outputPath('synthetic-files-narrow.png') });
  await page.getByRole('button', { name: '收起目录', exact: true }).click();
  await within(source(page, emptyPath), 736, 900);
  await expect(page.getByLabel('测试对话输入')).toHaveValue('合成承载的未提交输入');
  expect(unexpected).toEqual([]);
  await testInfo.attach('synthetic-input-evidence', { body: JSON.stringify({ input: syntheticSourceVersion, requestsFromSource: unexpected, scrollTop: position, tree, panel }, null, 2), contentType: 'application/json' });
});
