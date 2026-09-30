import { expect, test, type Locator } from '@playwright/test';

// Controlled long-content fixture; real production projects are verified separately.
const html = `<!DOCTYPE html><html><head></head><body><h1>桌面验证应用</h1><button disabled>增加</button><output>0</output><div style="height:1800px">可独立滚动的预览内容</div><p>预览底部</p><script>
let n=0;const b=document.querySelector('button'),o=document.querySelector('output');
atoms.loadState().then(s=>{n=s?.n??0;o.textContent=n;b.disabled=false});
b.onclick=async()=>{n++;o.textContent=n;await atoms.saveState({n})};</script></body></html>`;
async function withinViewport(locator: Locator, width: number, height: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}
for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  test(`长内容桌面路径、独立滚动与详情状态保全 ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let generations = 0;
    await page.route('**/api/generate', route => route.fulfill({ json: { html, model: 'desktop-fixture', durationMs: 1234, generatedAt: String(++generations) } }));
    await page.goto('/');
    await page.getByRole('button', { name: '待办清单' }).click();
    await expect(page.getByLabel('你想做什么？')).toHaveValue(/添加、完成、删除/);
    expect(generations).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('home.png') });
    const requirement = '长原需求桌面验证。' + '保留数据并支持连续修改，内容应完整可查看。\n'.repeat(70);
    await page.getByLabel('你想做什么？').fill(requirement);
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    const url = page.url();
    await page.frameLocator('iframe').getByRole('button', { name: '增加' }).press('Enter');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    // Seed prior adopted records to exercise long history without unnecessary generations.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('atoms-projects', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>(resolve => {
        const tx = db.transaction('projects', 'readwrite'); const store = tx.objectStore('projects');
        const r = store.get(new URLSearchParams(location.search).get('project')!);
        r.onsuccess = () => store.put({ ...r.result, modificationRecords: Array.from({ length: 12 }, (_, i) => ({ id: String(i), adoptedAt: '2026-09-29T08:00:00Z', requests: [`历史修改 ${i}：` + '检查长记录布局。'.repeat(20)], summary: `历史结果 ${i}` })) });
        tx.oncomplete = () => resolve();
      }); db.close();
    });
    await page.reload();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await expect(page.getByLabel('已采用修改记录')).toContainText('历史结果 11');
    for (let round = 0; round < 6; round++) {
      await page.getByLabel('追加修改需求').fill(`本轮修改 ${round}：` + '让布局更清楚且保留数据。'.repeat(18));
      await page.getByRole('button', { name: '生成候选', exact: true }).click();
      await expect(page.getByLabel('本轮对话').locator(':scope > li')).toHaveCount(round + 1);
    }
    const f = page.frameLocator('iframe');
    await f.getByRole('button', { name: '增加' }).press('Enter');
    await expect(f.locator('output')).toHaveText('2');
    await expect(page.locator('.data-status')).toContainText('仅本轮会话有效');
    await page.getByLabel('追加修改需求').fill('仍未提交的输入');
    const frameElement = await page.locator('iframe').elementHandle();
    const scroll = page.getByRole('region', { name: '项目对话与详情' });
    const frameBox = await page.locator('iframe').boundingBox();
    await scroll.hover(); await page.mouse.wheel(0, 900);
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.locator('iframe').boundingBox()).toEqual(frameBox);
    await page.locator('.project-details > summary').click();
    for (const name of ['原需求详情', '模型与耗时']) {
      const summary = page.locator('summary').filter({ hasText: name });
      await summary.focus(); await summary.press('Enter');
      await expect(summary.locator('..')).toHaveAttribute('open', '');
    }
    await expect(page.locator('.requirement-block p')).toHaveText(requirement);
    await expect(page.getByText('desktop-fixture')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('details.png') });
    for (const name of ['原需求详情', '模型与耗时']) {
      const summary = page.locator('summary').filter({ hasText: name });
      await summary.focus(); await summary.press('Enter');
    }
    await page.locator('.project-details > summary').click();
    const conversationTop = await scroll.evaluate(el => el.scrollTop);
    await f.getByRole('heading').hover(); await page.mouse.wheel(0, 700);
    await expect.poll(() => f.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await scroll.evaluate(el => el.scrollTop)).toBe(conversationTop);
    expect(await frameElement!.evaluate(el => el.isConnected)).toBe(true);
    await expect(page.getByLabel('追加修改需求')).toHaveValue('仍未提交的输入');
    await expect(f.locator('output')).toHaveText('2');
    await expect(page).toHaveURL(url);
    expect(generations).toBe(7);
    for (const locator of [page.getByLabel('追加修改需求'), page.getByRole('button', { name: '采用修改', exact: true }), page.getByRole('button', { name: '放弃本轮修改' }), page.locator('iframe')]) await withinViewport(locator, viewport.width, viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await f.locator('body').evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('candidate.png') });
    await page.getByRole('button', { name: '采用修改', exact: true }).click();
    await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
    await expect(f.locator('output')).toHaveText('1');
    await expect(page.getByLabel('已采用修改记录')).toContainText('已采用 6 轮调整');
    await page.getByRole('button', { name: /新建项目/ }).click();
    await page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /打开项目/ }).click();
    await expect(page).toHaveURL(url);
    await expect(f.locator('output')).toHaveText('1');
    expect(generations).toBe(7);
    await page.screenshot({ path: testInfo.outputPath('reopened.png') });
  });
}
