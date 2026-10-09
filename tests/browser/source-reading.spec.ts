import { build, type BuildResult } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { sourceReadingVersion } from '../fixtures/source-reading-files';

const origin = 'https://source-reading.test';
const source = (page: Page, path = 'index.html') => page.getByRole('region', { name: `源码 ${path}`, exact: true });
const search = (page: Page) => page.getByRole('searchbox', { name: '在当前文件中搜索' });
const result = (page: Page) => page.getByRole('status', { name: '当前文件搜索结果' });
let bundle: BuildResult;
test.beforeAll(async () => {
  bundle = await build({ entryPoints: ['tests/fixtures/source-reading-harness.tsx'], bundle: true, write: false, outdir: 'out', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
});
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`${origin}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>' });
    if (path === '/harness.js' || path === '/harness.css') return route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : 'text/css', body: bundle.outputFiles!.find(file => file.path.endsWith(path.endsWith('.js') ? '.js' : '.css'))!.text });
    throw new Error(`Unexpected request: ${route.request().url()}`);
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
});

test('当前文件搜索、键盘前后定位、长行滚动与同名文件切换', async ({ page }, testInfo) => {
  await source(page).focus();
  await page.keyboard.press('ControlOrMeta+f');
  await expect(search(page)).toBeFocused();
  await search(page).fill('find.me');
  await expect(result(page)).toHaveText('1 / 2');
  await search(page).press('Enter'); await expect(result(page)).toHaveText('2 / 2');
  await search(page).press('Enter'); await expect(result(page)).toHaveText('1 / 2');
  await search(page).press('Shift+Enter'); await expect(result(page)).toHaveText('2 / 2');
  await page.getByRole('button', { name: '上一处匹配' }).click(); await expect(result(page)).toHaveText('1 / 2');
  await page.getByRole('button', { name: '目录 one', exact: true }).click();
  await page.getByRole('button', { name: 'one/index.ts', exact: true }).click();
  await expect(result(page)).toHaveText('1 / 2');
  await page.getByRole('button', { name: '下一处匹配' }).click();
  await expect(result(page)).toHaveText('2 / 2');
  await expect.poll(() => source(page, 'one/index.ts').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => source(page, 'one/index.ts').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const currentMatch = source(page, 'one/index.ts').locator('mark[data-active="true"]').first();
  const area = (await source(page, 'one/index.ts').boundingBox())!, match = (await currentMatch.boundingBox())!;
  expect(match.y).toBeGreaterThanOrEqual(area.y); expect(match.y + match.height).toBeLessThanOrEqual(area.y + area.height);
  expect(match.x).toBeGreaterThanOrEqual(area.x); expect(match.x + match.width).toBeLessThanOrEqual(area.x + area.width);
  await page.getByRole('button', { name: '目录 two', exact: true }).click();
  await page.getByRole('button', { name: 'two/index.ts', exact: true }).click();
  await expect(result(page)).toHaveText('无匹配');
  await expect(page.getByRole('button', { name: '下一处匹配' })).toBeDisabled();
  await expect(source(page, 'two/index.ts').locator('mark')).toHaveCount(0);
  await page.getByRole('button', { name: 'one/index.ts', exact: true }).click();
  await expect(result(page)).toHaveText('1 / 2');
  await search(page).press('Escape'); await expect(search(page)).toHaveValue('');
  await search(page).fill('const value'); // Match crosses syntax token boundaries.
  await expect(result(page)).toHaveText('1 / 1');
  expect((await source(page, 'one/index.ts').locator('mark').allTextContents()).join('')).toBe('const value');
  await page.screenshot({ path: testInfo.outputPath('reading-desktop.png') });
});

test('实际剪贴板逐字符复制原文、未知语言及空文件，阅读保留同版本预览与输入', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const app = page.frameLocator('iframe');
  await app.getByLabel('应用输入').fill('未提交的预览输入');
  const instance = await app.locator('#instance').textContent();
  await page.getByLabel('测试对话输入').fill('未提交的对话输入');
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  await search(page).fill('find.me');
  for (const path of ['index.html', 'notes.unknown', 'empty.txt']) {
    await page.getByRole('button', { name: path, exact: true }).click();
    const raw = sourceReadingVersion.files.find(file => file.path === path)!.text;
    expect(await source(page, path).locator('code').textContent()).toBe(raw);
    await expect(source(page, path).locator('script,img,h1,style')).toHaveCount(0);
    await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
    await expect(page.getByText('已复制当前文件的完整源码')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  }
  await expect(page.getByText('空文本文件', { exact: true })).toBeVisible();
  expect(await page.locator('body').getAttribute('data-source-executed')).toBeNull();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(app.getByLabel('应用输入')).toHaveValue('未提交的预览输入');
  expect(await app.locator('#instance').textContent()).toBe(instance);
  await expect(page.getByLabel('测试对话输入')).toHaveValue('未提交的对话输入');
  await page.getByRole('button', { name: '查看代码', exact: true }).click();
  await page.setViewportSize({ width: 736, height: 900 });
  await page.getByRole('button', { name: '展开目录' }).click();
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await page.getByRole('button', { name: '收起目录' }).click();
  for (const locator of [search(page), page.getByRole('button', { name: '复制当前文件', exact: true }), source(page)]) {
    const box = (await locator.boundingBox())!;
    expect(box.x).toBeGreaterThan(270); expect(box.x + box.width).toBeLessThanOrEqual(736); expect(box.y + box.height).toBeLessThanOrEqual(900);
  }
  await page.screenshot({ path: testInfo.outputPath('reading-narrow.png') });
});

test('剪贴板拒绝或不可用如实反馈，源码仍可手动选择', async ({ page }) => {
  for (const unavailable of [false, true]) {
    await page.evaluate(unavailable => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: unavailable ? undefined : { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } } }), unavailable);
    await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('复制失败：无法写入剪贴板，请选中下方源码后手动复制。');
    await expect(page.getByText('已复制当前文件的完整源码')).toHaveCount(0);
  }
  await source(page).focus();
  const box = (await source(page).boundingBox())!;
  await page.mouse.move(box.x + 63, box.y + 24); await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 24); await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('<!doctype');
});

test('未完成的剪贴板写入不会提前成功或污染另一个同名文件', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>(resolve => { window.addEventListener('release-copy', () => resolve(), { once: true }); }) } }));
  await page.getByRole('button', { name: '目录 one', exact: true }).click();
  await page.getByRole('button', { name: '目录 two', exact: true }).click();
  await page.getByRole('button', { name: 'one/index.ts', exact: true }).click();
  await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制中…' })).toBeDisabled();
  await expect(page.getByText('已复制当前文件的完整源码')).toHaveCount(0);
  await page.getByRole('button', { name: 'two/index.ts', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('release-copy')));
  await expect(page.getByText('已复制当前文件的完整源码')).toHaveCount(0);
  await page.getByRole('button', { name: 'one/index.ts', exact: true }).click();
  await expect(page.getByText('已复制当前文件的完整源码')).toHaveCount(0);
});
