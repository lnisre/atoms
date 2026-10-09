import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fulfillGeneration } from './team-fixture';

const source = (page: Page, path = 'index.html') => page.getByRole('region', { name: `源码 ${path}`, exact: true });
const codeMode = (page: Page) => page.getByRole('button', { name: '查看代码', exact: true });
const previewMode = (page: Page) => page.getByRole('button', { name: '预览', exact: true });
const directory = (page: Page, path: string) => page.getByRole('button', { name: `目录 ${path}`, exact: true });
const position = (page: Page, path: string) => source(page, path).evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));

async function openHarness(page: Page) {
  const bundle = await build({ entryPoints: ['tests/fixtures/source-version-harness.tsx'], bundle: true, write: false, outdir: 'out', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  await page.route('https://source-version.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>' });
    const suffix = path.endsWith('.js') ? '.js' : '.css';
    return route.fulfill({ contentType: suffix === '.js' ? 'text/javascript' : 'text/css', body: bundle.outputFiles!.find(file => file.path.endsWith(suffix))!.text });
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://source-version.test/');
  await codeMode(page).click();
}

async function scrollSource(page: Page, path: string) {
  await source(page, path).hover();
  await page.mouse.wheel(350, 1200);
  await expect.poll(() => position(page, path)).toEqual({ top: 1200, left: 350 });
  return position(page, path);
}

test('合成版本更新保留选择、目录与各文件阅读位置，缩短后收敛到有效范围', async ({ page }) => {
  await openHarness(page);
  const entryPosition = await scrollSource(page, 'index.html');
  await directory(page, 'src').click();
  await directory(page, 'src/components').click();
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  await page.getByRole('searchbox', { name: '在当前文件中搜索' }).fill(' 1 ');
  await expect(page.getByLabel('当前文件搜索结果')).toHaveText('1 / 1');
  await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
  await expect(page.getByText('已复制当前文件的完整源码', { exact: true })).toBeVisible();
  const mainPosition = await scrollSource(page, 'src/main.ts');
  await page.getByRole('button', { name: '收起目录', exact: true }).click();
  await page.getByRole('button', { name: '合成更新', exact: true }).click();
  await expect(codeMode(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('源码已更新至当前展示版本。', { exact: true })).toBeVisible();
  await expect(source(page, 'src/main.ts')).toContainText('新候选内容 1');
  await expect(source(page, 'src/main.ts')).not.toContainText('src/main.ts 1');
  expect(await position(page, 'src/main.ts')).toEqual(mainPosition);
  await expect(page.getByLabel('当前文件搜索结果')).toHaveText('1 / 1');
  await expect(page.getByText('已复制当前文件的完整源码', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
  await expect(page.getByText('已复制当前文件的完整源码', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await source(page, 'src/main.ts').textContent());
  await page.getByRole('searchbox', { name: '在当前文件中搜索' }).fill('');
  await expect(page.getByRole('navigation', { name: '项目文件' })).toBeHidden();
  await page.getByRole('button', { name: '展开目录', exact: true }).click();
  await expect(directory(page, 'src')).toHaveAttribute('aria-expanded', 'true');
  await expect(directory(page, 'src/components')).toHaveAttribute('aria-expanded', 'true');
  await directory(page, 'new').click();
  await page.getByRole('button', { name: 'new/added.txt', exact: true }).click();
  await expect(source(page, 'new/added.txt')).toHaveText('新版本新增的合成文件');
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  expect(await position(page, 'index.html')).toEqual(entryPosition);
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  expect(await position(page, 'src/main.ts')).toEqual(mainPosition);
  await page.getByRole('button', { name: '合成缩短', exact: true }).click();
  await expect(source(page, 'src/main.ts')).toHaveText('缩短后的新源码');
  expect(await position(page, 'src/main.ts')).toEqual({ top: 0, left: 0 });
  await previewMode(page).click();
  await expect(page.getByText('合成预览版本：synthetic-shortened')).toBeVisible();
  await codeMode(page).click();
  await expect(source(page, 'src/main.ts')).toHaveText('缩短后的新源码');
});

test('合成移除当前文件回到新入口并解释，移除目录与位置不会在重新添加时复活', async ({ page }) => {
  await openHarness(page);
  await directory(page, 'src').click();
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  await scrollSource(page, 'src/main.ts');
  await page.getByRole('button', { name: '合成移除', exact: true }).click();
  await expect(page.getByLabel('当前文件路径')).toHaveText('app/start.html');
  await expect(source(page, 'app/start.html')).toHaveText('<h1>新入口 · 合成输入</h1>');
  await expect(page.getByRole('status').filter({ hasText: '源码已更新。文件' })).toHaveText('源码已更新。文件“src/main.ts”已从此版本移除，已打开入口文件“app/start.html”。');
  await expect(directory(page, 'app')).toHaveAttribute('aria-expanded', 'true');
  await expect(directory(page, 'src')).toHaveCount(0);
  await page.getByRole('button', { name: '合成恢复', exact: true }).click();
  await expect(page.getByLabel('当前文件路径')).toHaveText('index.html');
  await expect(directory(page, 'src')).toHaveAttribute('aria-expanded', 'false');
  await directory(page, 'src').click();
  await page.getByRole('button', { name: 'src/main.ts', exact: true }).click();
  expect(await position(page, 'src/main.ts')).toEqual({ top: 0, left: 0 });
});

const html = (version: string) => `<!doctype html><html><head></head><body><h1>${version}</h1>
<label>业务内容<input aria-label="业务内容" disabled></label><button disabled>保存业务内容</button><output></output>
<script>const input=document.querySelector('input'),button=document.querySelector('button'),output=document.querySelector('output');
atoms.loadState().then(s=>{input.value=s?.text??'';output.textContent=input.value;input.disabled=button.disabled=false});
button.onclick=async()=>{await atoms.saveState({text:input.value});output.textContent=input.value};</script>
${Array.from({ length: 120 }, (_, i) => `<!-- ${version} 源码 ${i} -->`).join('\n')}
</body></html>`;

async function begin(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html: html('正式成果'), model: 'T3 SYNTHETIC', durationMs: 1, generatedAt: 'initial' } }));
  await page.goto('/');
  await page.getByLabel('你想做什么？').fill('T3 版本同步专项');
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  await page.unroute('**/api/generate');
}

async function modify(page: Page) {
  await page.getByLabel('追加修改需求', { exact: true }).fill('修改整个应用');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
}

test('代码模式等待完整候选后自动同步，继续修改与放弃均对应整个版本', async ({ page }) => {
  await begin(page);
  await codeMode(page).click();
  await source(page).hover(); await page.mouse.wheel(0, 650);
  await expect.poll(() => source(page).evaluate(el => el.scrollTop)).toBe(650);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const inputs: { baseHtml: string }[] = [];
  await page.route('**/api/generate', async route => {
    inputs.push(route.request().postDataJSON());
    await gate;
    return fulfillGeneration(route, { json: { html: html(`候选${inputs.length}`), model: 'T3 SYNTHETIC', durationMs: 1, generatedAt: String(inputs.length) } });
  });
  await modify(page);
  await expect.poll(() => inputs.length).toBe(1);
  await expect(source(page).locator('code')).toHaveText(html('正式成果'));
  await expect(page.getByText(/现有预览与完整源码仍可查看/)).toBeVisible();
  release();
  await expect(source(page).locator('code')).toHaveText(html('候选1'));
  await expect(codeMode(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('候选版本 · 未采用', { exact: true })).toBeVisible();
  await expect(page.getByText('源码已更新至当前展示版本。', { exact: true })).toBeVisible();
  expect(await source(page).evaluate(el => el.scrollTop)).toBe(650);
  await previewMode(page).click();
  await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText('候选1');
  await codeMode(page).click();
  await modify(page);
  await expect(source(page).locator('code')).toHaveText(html('候选2'));
  expect(inputs.map(input => input.baseHtml)).toEqual([html('正式成果'), html('候选1')]);
  await page.getByRole('button', { name: '放弃本轮修改', exact: true }).click();
  await expect(source(page).locator('code')).toHaveText(html('正式成果'));
  await expect(codeMode(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await source(page).evaluate(el => el.scrollTop)).toBe(650);
  await expect(page.getByText('已采用版本', { exact: true })).toBeVisible();
  await previewMode(page).click();
  await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText('正式成果');
  expect(inputs).toHaveLength(2);
});

test('代码模式采用失败保留候选，成功后源码不变并使用正式数据', async ({ page }) => {
  await begin(page);
  const app = page.frameLocator('iframe');
  await app.getByLabel('业务内容').fill('正式数据');
  await app.getByRole('button', { name: '保存业务内容' }).press('Enter');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html: html('待采用候选'), model: 'T3 SYNTHETIC', durationMs: 1, generatedAt: 'candidate' } }));
  await modify(page);
  await expect(app.getByRole('heading')).toHaveText('待采用候选');
  await app.getByLabel('业务内容').fill('仅用于试用');
  await app.getByRole('button', { name: '保存业务内容' }).press('Enter');
  await expect(app.locator('output')).toHaveText('仅用于试用');
  await codeMode(page).click();
  // Hold then abort the actual adoption transaction; no component state injection.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      const control = window as typeof window & { abortAdoption?: boolean };
      const hold = () => {
        if (control.abortAdoption) return this.transaction.abort();
        this.get('__keep_transaction_alive__').addEventListener('success', hold);
      };
      request.addEventListener('success', hold);
      return request;
    };
  });
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在保存采用…', exact: true })).toBeDisabled();
  await expect(page.getByText('候选版本 · 未采用', { exact: true })).toBeVisible();
  await expect(source(page).locator('code')).toHaveText(html('待采用候选'));
  await page.evaluate(() => { (window as typeof window & { abortAdoption: boolean }).abortAdoption = true; });
  await expect(page.getByLabel('候选操作').getByRole('alert')).toContainText('采用保存失败');
  await expect(page.getByText('候选版本 · 未采用', { exact: true })).toBeVisible();
  await expect(source(page).locator('code')).toHaveText(html('待采用候选'));
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByText('已采用版本', { exact: true })).toBeVisible();
  await expect(source(page).locator('code')).toHaveText(html('待采用候选'));
  await expect(codeMode(page)).toHaveAttribute('aria-pressed', 'true');
  await previewMode(page).click();
  await expect(app.getByRole('heading')).toHaveText('待采用候选');
  await expect(app.getByLabel('业务内容')).toHaveValue('正式数据');
});
