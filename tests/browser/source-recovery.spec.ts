import { expect, test, type Page } from '@playwright/test';
import { respond } from './reviewer-preview-fixture';
import { fulfillGeneration } from './team-fixture';

const codeMode = (page: Page) => page.getByRole('button', { name: '查看代码', exact: true });
const previewMode = (page: Page) => page.getByRole('button', { name: '预览', exact: true });
const source = (page: Page) => page.getByRole('region', { name: '源码 index.html', exact: true });
const viewer = (page: Page) => page.getByRole('region', { name: '项目成果', exact: true });

async function start(page: Page, title: string) {
  await page.getByLabel('你想做什么？').fill(title);
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
}
async function searchAndCopy(page: Page, html: string, query: string) {
  await codeMode(page).click();
  await expect(source(page).locator('code')).toHaveText(html);
  await page.getByRole('searchbox', { name: '在当前文件中搜索' }).fill(query);
  await expect(page.getByLabel('当前文件搜索结果')).toHaveText('1 / 1');
  await page.getByRole('button', { name: '复制当前文件', exact: true }).click();
  await expect(page.getByText('已复制当前文件的完整源码', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(html);
}
async function storedProject(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('atoms-projects');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ result: { html: string }; draftResult?: { html: string } }>((resolve, reject) => {
        const request = db.transaction('projects').objectStore('projects').get(new URLSearchParams(location.search).get('project')!);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}
async function expectFreshPreview(page: Page) {
  await expect(previewMode(page)).toHaveAttribute('aria-pressed', 'true');
  await codeMode(page).click();
  await expect(page.getByLabel('当前文件路径')).toHaveText('index.html');
  await expect(page.getByRole('searchbox', { name: '在当前文件中搜索' })).toHaveValue('');
  expect(await source(page).evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))).toEqual({ top: 0, left: 0 });
}
async function expectSideBySide(page: Page) {
  const left = await page.locator('.project-panel').boundingBox();
  const right = await viewer(page).boundingBox();
  expect(left!.y).toBe(right!.y);
  expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x + 1);
  const visibleSource = await source(page).boundingBox();
  expect(visibleSource!.height).toBeGreaterThan(80);
  expect(visibleSource!.x + visibleSource!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const mode of ['fatal', 'unknown'] as const) test(`${mode}: 受限成果重开读取真实源码，查看与复制保留执行和采用限制`, async ({ page }, testInfo) => {
  let html = '', requests = 0;
  await page.route('**/api/generate', async route => { requests++; html = await respond(route, mode); });
  await page.goto('/');
  await start(page, `T4 ${mode} 受限源码`);
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  const stored = await storedProject(page);
  expect(stored.draftResult?.html).toBe(html);
  expect(stored.result.html).not.toBe(html);
  await searchAndCopy(page, html, mode === 'fatal' ? 'while(true){}' : 'state.count+=2');
  if (mode === 'fatal') {
    await expect(page.getByText('请在右侧预览中实际操作，确认应用符合需求。', { exact: true })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(viewer(page).getByText(/禁止运行：/)).toBeVisible();
    await expect(page.getByRole('button', { name: '使用此版本' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('blocked-code-1440.png') });
  } else {
    await expect(page.getByRole('button', { name: '使用此版本' })).toBeEnabled();
  }
  await page.reload();
  await expectFreshPreview(page);
  await searchAndCopy(page, html, 'state.count+=2');
  if (mode === 'fatal') await expect(page.locator('iframe')).toHaveCount(0);
  const projectUrl = page.url();
  // Same React page, another project: no source or reading state crosses projects.
  await page.getByRole('button', { name: 'Atoms 首页', exact: true }).click();
  await page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /专注番茄钟/ }).click();
  await expectFreshPreview(page);
  await expect(source(page)).not.toContainText('审查预览夹具');
  await expect(page.getByText('首次生成 · 已保存', { exact: true })).toHaveCount(0);
  await page.goto(projectUrl);
  await expectFreshPreview(page);
  await searchAndCopy(page, html, 'state.count+=2');
  expect(requests).toBe(1);
});

test('待验证成果保存失败仍可复制，736px 下未保存反馈与阅读操作可达', async ({ page }, testInfo) => {
  let html = '', requests = 0;
  await page.route('**/api/generate', async route => { requests++; html = await respond(route, 'unknown'); });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /专注番茄钟/ })).toBeVisible();
  // Fail only the new project's actual write, after normal workspace setup.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 736, height: 900 });
  await start(page, 'T4 保存失败仍可阅读');
  await expect(viewer(page).getByRole('alert')).toContainText('完整源码仅保留在本页');
  await expect(page.getByText('请在右侧预览中实际操作，确认应用符合需求。', { exact: true })).toHaveCount(0);
  await expect(viewer(page).getByText('尚未保存', { exact: true })).toBeVisible();
  await expect(page.getByText(/代码与问题已保存/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '使用此版本' })).toBeDisabled();
  await searchAndCopy(page, html, 'state.count+=2');
  await expect(page.getByRole('navigation', { name: '项目文件' })).toBeHidden();
  await expectSideBySide(page);
  await page.screenshot({ path: testInfo.outputPath('unsaved-code-736.png') });
  await page.reload();
  await expect(page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /T4 保存失败仍可阅读/ })).toHaveCount(0);
  expect(requests).toBe(1);
});

const htmlFor = (version: string) => `<!doctype html><html><head></head><body><h1>${version}</h1>
<input aria-label="业务内容" disabled><button disabled>保存业务内容</button><output></output>
<script>const input=document.querySelector('input'),button=document.querySelector('button'),output=document.querySelector('output');
atoms.loadState().then(s=>{input.value=s?.text??'';output.textContent=input.value;input.disabled=button.disabled=false});
button.onclick=async()=>{await atoms.saveState({text:input.value});output.textContent=input.value};</script>
${Array.from({ length: 120 }, (_, i) => `<!-- 源码行 ${i} ${'长源码 '.repeat(30)} -->`).join('\n')}
</body></html>`;
async function modify(page: Page) {
  await page.getByLabel('追加修改需求', { exact: true }).fill('调整当前应用');
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled();
}

test('多轮采用及失败后重开，查找复制正确版本并恢复正式数据', async ({ page, context }, testInfo) => {
  let version = '初始代码', requests = 0;
  context.on('request', request => { if (request.url().endsWith('/api/generate')) requests++; });
  await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html: htmlFor(version), model: 'T4 SYNTHETIC', durationMs: 1, generatedAt: version } }));
  await page.goto('/');
  await start(page, 'T4 采用与重开');
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  const app = page.frameLocator('iframe');
  await app.getByLabel('业务内容').fill('正式数据');
  await app.getByRole('button', { name: '保存业务内容' }).press('Enter');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  for (const next of ['采用一', '采用二']) {
    version = next;
    await modify(page);
    await previewMode(page).click();
    await expect(app.getByRole('heading')).toHaveText(version);
    await app.getByLabel('业务内容').fill('试用数据');
    await app.getByRole('button', { name: '保存业务内容' }).press('Enter');
    await expect(app.locator('output')).toHaveText('试用数据');
    await searchAndCopy(page, htmlFor(version), `<h1>${version}</h1>`);
    await page.getByRole('button', { name: '采用修改', exact: true }).click();
    await expect(page.getByText('已采用版本', { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(app.getByLabel('业务内容')).toHaveValue('正式数据');
  await expectFreshPreview(page);
  await searchAndCopy(page, htmlFor('采用二'), '<h1>采用二</h1>');
  expect((await storedProject(page)).result.html).toBe(htmlFor('采用二'));
  version = '未采用三';
  await modify(page);
  // Abort the adoption transaction, preserving the previously committed version.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  await page.setViewportSize({ width: 736, height: 900 });
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByLabel('候选操作').getByRole('alert')).toContainText('采用保存失败');
  await searchAndCopy(page, htmlFor(version), '<h1>未采用三</h1>');
  await expectSideBySide(page);
  await expect(page.getByRole('button', { name: '放弃本轮修改', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('adoption-failed-736.png') });
  expect((await storedProject(page)).result.html).toBe(htmlFor('采用二'));
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.frameLocator('iframe').getByLabel('业务内容')).toHaveValue('正式数据');
  await expectFreshPreview(reopened);
  await searchAndCopy(reopened, htmlFor('采用二'), '<h1>采用二</h1>');
  await expect(reopened.getByLabel('候选操作')).toHaveCount(0);
  expect(requests).toBe(4);
});

test('已有项目读取失败如实报错，恢复读取后默认预览而非空成果', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/generate', route => { requests++; return fulfillGeneration(route, { json: { html: htmlFor('可恢复代码'), model: 'T4 SYNTHETIC', durationMs: 1, generatedAt: 'read' } }); });
  await page.goto('/');
  await start(page, 'T4 读取失败');
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  await codeMode(page).click();
  await page.addInitScript(() => {
    const getAll = IDBObjectStore.prototype.getAll;
    (window as typeof window & { restoreProjectReads: () => void }).restoreProjectReads = () => { IDBObjectStore.prototype.getAll = getAll; };
    IDBObjectStore.prototype.getAll = function () {
      throw new DOMException('blocked', 'UnknownError');
    };
  });
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: '无法读取已有项目' })).toBeVisible();
  await expect(page.getByText('还没有已保存的项目', { exact: true })).toHaveCount(0);
  await expect(codeMode(page)).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.evaluate(() => { (window as typeof window & { restoreProjectReads: () => void }).restoreProjectReads(); });
  await page.getByRole('button', { name: '重试读取与准备' }).click();
  await expectFreshPreview(page);
  await searchAndCopy(page, htmlFor('可恢复代码'), '<h1>可恢复代码</h1>');
  expect(requests).toBe(1);
});
