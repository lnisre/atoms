import { fulfillGeneration } from "./team-fixture";
import { test, expect } from '@playwright/test';

// Controlled old-format projects verify entry behavior; these are not real generation evidence.
const html = `<!DOCTYPE html><html><head></head><body><h1>入口回归应用</h1><button disabled>增加</button><output>0</output><script>
let n=0;const b=document.querySelector('button'),o=document.querySelector('output');
atoms.loadState().then(s=>{n=s?.n??0;o.textContent=n;b.disabled=false});
b.onclick=async()=>{o.textContent=++n;await atoms.saveState({n})};</script></body></html>`;
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test(`首页与项目网格真实接线、禁用与恢复 ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    let calls = 0;
    await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html, model: 'entry-fixture', generatedAt: String(++calls), durationMs: 1000 } }));
    await page.goto('/');
    await expect(page.getByText('正在读取已有项目…')).toHaveCount(0);
    await page.evaluate(async html => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('atoms-projects', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>(resolve => {
        const tx = db.transaction(['projects', 'applicationData'], 'readwrite');
        for (let i = 0; i < 7; i++) tx.objectStore('projects').put({ id: `old-${i}`, title: i === 0 ? '旧项目：保留数据与较长中文标题，用于检查溢出' : `入口回归项目 ${i}`, requirement: `旧项目需求 ${i}`, updatedAt: `2026-09-${30-i}T01:00:00Z`, result: { html, generatedAt: 'old', model: 'old-fixture', durationMs: 10 } });
        tx.objectStore('applicationData').put({ projectId: 'old-0', state: { n: 7 }, updatedAt: '2026-09-30T01:00:00Z' });
        tx.oncomplete = () => resolve();
      }); db.close();
    }, html);
    await page.reload();
    await expect(page.getByRole('region', { name: '最近项目' }).getByRole('button')).toHaveCount(5);
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('home.png') });
    await page.getByRole('button', { name: '待办清单' }).click();
    await expect(page.getByLabel('你想做什么？')).toHaveValue(/添加、完成、删除/);
    const draft = await page.getByLabel('你想做什么？').inputValue();
    const disabled = page.getByRole('button', { name: /当前未提供/ });
    expect(await disabled.count()).toBeGreaterThan(10);
    for (const button of await disabled.all()) {
      await expect(button).toBeDisabled();
      // HTMLButtonElement.click must not bypass native disabled, including in a form.
      await button.evaluate((element: HTMLButtonElement) => element.click());
    }
    await page.getByRole('button', { name: 'Atoms 首页' }).focus();
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.hasAttribute('disabled'))).toBe(false);
    }
    expect(calls).toBe(0);
    const sidebar = page.getByRole('complementary', { name: '侧栏' });
    const before = await sidebar.boundingBox();
    await page.getByRole('button', { name: '我的项目', exact: true }).click();
    const region = page.getByRole('region', { name: '已有项目' });
    const cards = region.getByRole('button', { name: /打开项目/ });
    await expect(cards).toHaveCount(7);
    await expect(region.getByText('项目封面占位')).toHaveCount(7);
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('projects.png') });
    await page.getByRole('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await sidebar.boundingBox()).toEqual(before);
    expect(calls).toBe(0);
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.getByLabel('你想做什么？')).toHaveValue(draft);
    for (const locator of [page.getByLabel('你想做什么？'), page.getByRole('button', { name: '开始生成' }), page.getByRole('button', { name: '我的项目', exact: true })]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.getByRole('region', { name: '最近项目' }).getByRole('button').first().click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('7');
    await page.frameLocator('iframe').getByRole('button', { name: '增加' }).press('Enter');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /新建项目/ }).click();
    await page.getByRole('button', { name: '我的项目', exact: true }).click();
    await cards.filter({ hasText: '旧项目：' }).click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('8');
    expect(calls).toBe(0);
    await page.getByRole('button', { name: /新建项目/ }).click();
    await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await page.getByLabel('你想做什么？').fill('首页入口新生成');
    await page.getByRole('button', { name: '开始生成' }).press('Enter');
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    await page.frameLocator('iframe').getByRole('button', { name: '增加' }).press('Enter');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    expect(calls).toBe(1);
    await page.getByRole('button', { name: /新建项目/ }).click();
    await page.getByRole('button', { name: '我的项目', exact: true }).click();
    await expect(cards).toHaveCount(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('空项目入口与存储失败反馈可达', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.getByRole('button', { name: '创建第一个应用' }).click();
  await expect(page.getByLabel('你想做什么？')).toBeVisible();
  await page.goto('/?project=missing');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('此浏览器中找不到该项目');
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
});
