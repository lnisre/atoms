import { expect, test, type Page } from '@playwright/test';
import { fulfillGeneration } from './team-fixture';
import { respond, type Mode } from './reviewer-preview-fixture';

const source = (page: Page) => page.getByRole('region', { name: '源码 index.html', exact: true });
const code = (page: Page) => page.getByRole('button', { name: '查看代码', exact: true });
const preview = (page: Page) => page.getByRole('button', { name: '预览', exact: true });
const html = (label: string) => `<!doctype html><html><head></head><body><h1>${label}</h1><input aria-label="草稿"><button disabled>保存</button><output></output><script>
const input=document.querySelector('input'),button=document.querySelector('button'),output=document.querySelector('output');
atoms.loadState().then(s=>{input.value=s?.text??'';output.textContent=input.value;button.disabled=false});
button.onclick=async()=>{await atoms.saveState({text:input.value});output.textContent=input.value};
</script></body></html>`;
async function begin(page: Page) {
  await page.goto('/');
  await page.getByLabel('你想做什么？').fill('PRD 集中验收合成项目');
  await page.getByRole('button', { name: '开始生成', exact: true }).click();
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
}
async function modify(page: Page, text: string) {
  await page.getByLabel('追加修改需求', { exact: true }).fill(text);
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('atoms-projects'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const id = new URLSearchParams(location.search).get('project')!;
    const get = (store: string) => new Promise<unknown>((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(id); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error); });
    try { return { project: await get('projects'), data: await get('applicationData') }; } finally { db.close(); }
  });
}

test('真实工作台搜索复制保全正式与试用数据、iframe、输入和请求数', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let version = '正式源码', requests = 0;
  await page.route('**/api/generate', route => { requests++; return fulfillGeneration(route, { json: { html: html(version), model: 'OFFLINE SOURCE ACCEPTANCE', durationMs: 1, generatedAt: version } }); });
  await begin(page);
  const app = page.frameLocator('iframe');
  const observations = [];
  for (const trial of [false, true]) {
    if (trial) { version = '候选源码'; await modify(page, '生成试用版本'); await expect(page.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled(); }
    await app.getByLabel('草稿').fill(trial ? '试用数据' : '正式数据');
    await app.getByRole('button', { name: '保存', exact: true }).press('Enter');
    await expect(app.locator('output')).toHaveText(trial ? '试用数据' : '正式数据');
    if (!trial) await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    await app.getByLabel('草稿').fill('未提交输入');
    await page.getByLabel('追加修改需求', { exact: true }).fill('未提交修改');
    const frame = (await page.locator('iframe').elementHandle())!;
    const before = await snapshot(page), beforeRequests = requests;
    await code(page).click();
    await page.getByRole('searchbox', { name: '在当前文件中搜索' }).fill('document');
    await expect(page.getByLabel('当前文件搜索结果')).toHaveText('1 / 3');
    await page.getByRole('button', { name: '下一处匹配' }).click();
    await expect(page.getByLabel('当前文件搜索结果')).toHaveText('2 / 3');
    await page.getByRole('button', { name: '复制当前文件', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('已复制当前文件的完整源码')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(html(version));
    expect(await snapshot(page)).toEqual(before);
    expect(requests).toBe(beforeRequests);
    await expect(page.getByText(trial ? '候选版本 · 未采用' : '已采用版本', { exact: true })).toBeVisible();
    await preview(page).click();
    expect(await frame.evaluate(el => el.isConnected)).toBe(true);
    await expect(app.getByLabel('草稿')).toHaveValue('未提交输入');
    await expect(app.locator('output')).toHaveText(trial ? '试用数据' : '正式数据');
    await expect(page.getByLabel('追加修改需求', { exact: true })).toHaveValue('未提交修改');
    observations.push({ trial, beforeRequests, afterRequests: requests, before, after: await snapshot(page) });
  }
  await info.attach('reading-side-effects', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
});

test('代码模式修改失败、执行阻断、停止与迟到结果均保留已有候选', async ({ page }, info) => {
  let mode: 'initial' | 'candidate' | 'failed' | 'fatal' | 'late' = 'initial', requests = 0;
  let release!: () => void, entered = false, delivered = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/generate', async route => {
    requests++;
    if (mode === 'failed') return fulfillGeneration(route, { status: 502, json: { error: '受控修改失败' } });
    if (mode === 'fatal') { await respond(route, 'fatal'); return; }
    if (mode === 'late') { entered = true; await gate; await fulfillGeneration(route, { json: { html: html('迟到源码'), model: 'OFFLINE LATE', durationMs: 1, generatedAt: 'late' } }).catch(() => {}); delivered = true; return; }
    return fulfillGeneration(route, { json: { html: html(mode), model: 'OFFLINE SOURCE ACCEPTANCE', durationMs: 1, generatedAt: mode } });
  });
  await begin(page);
  mode = 'candidate'; await modify(page, mode);
  await expect(page.getByRole('button', { name: '采用修改', exact: true })).toBeEnabled();
  await code(page).click();
  const before = await snapshot(page);
  for (const failure of ['failed', 'fatal'] as const) {
    mode = failure; await modify(page, failure);
    await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成候选', exact: true })).toBeEnabled();
    expect(await source(page).locator('code').textContent()).toBe(html('candidate'));
    await expect(page.getByText('候选版本 · 未采用', { exact: true })).toBeVisible();
    expect((await snapshot(page)).data).toEqual(before.data);
  }
  mode = 'late'; await modify(page, mode); await expect.poll(() => entered).toBe(true);
  expect(await source(page).locator('code').textContent()).toBe(html('candidate'));
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toContainText('任务已停止');
  release(); await expect.poll(() => delivered).toBe(true);
  expect(await source(page).locator('code').textContent()).toBe(html('candidate'));
  await preview(page).click(); await expect(page.frameLocator('iframe').getByRole('heading')).toHaveText('candidate');
  await page.reload(); await expect(preview(page)).toHaveAttribute('aria-pressed', 'true');
  await code(page).click(); expect(await source(page).locator('code').textContent()).toBe(html('initial'));
  expect(requests).toBe(5);
  await info.attach('failed-modifications', { body: JSON.stringify({ requests, before, afterReopen: await snapshot(page), lateResponseReleased: delivered }, null, 2), contentType: 'application/json' });
});

test('代码模式不解除数据风险采用限制，明确修复后采用仍排除试用数据', async ({ page }, info) => {
  let mode: Mode = 'clean', currentHtml = '', requests = 0;
  await page.route('**/api/generate', async route => { requests++; currentHtml = await respond(route, mode); });
  await begin(page);
  await page.frameLocator('iframe').getByRole('button', { name: '增加' }).press('Enter');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  const formal = (await snapshot(page)).data;
  for (const next of ['data', 'unknown', 'resolved'] as const) {
    mode = next; await modify(page, next);
    await expect(page.getByText(`第 ${['data', 'unknown', 'resolved'].indexOf(next) + 1} 轮候选 · 等待采用`, { exact: true })).toBeVisible();
    await code(page).click(); expect(await source(page).locator('code').textContent()).toBe(currentHtml);
    const adopt = page.getByRole('button', { name: '采用修改', exact: true });
    if (next === 'resolved') await expect(adopt).toBeEnabled(); else await expect(adopt).toBeDisabled();
    expect((await snapshot(page)).data).toEqual(formal);
    await preview(page).click();
    if (next === 'data') { await page.frameLocator('iframe').getByRole('button', { name: '增加' }).press('Enter'); await expect(page.frameLocator('iframe').locator('output')).toHaveText('4'); }
  }
  await code(page).click();
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByText('已采用版本', { exact: true })).toBeVisible();
  expect((await snapshot(page)).data).toEqual(formal);
  await preview(page).click(); await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  expect(requests).toBe(4);
  await info.attach('risk-adoption', { body: JSON.stringify({ requests, formal, afterAdoption: await snapshot(page) }, null, 2), contentType: 'application/json' });
});
