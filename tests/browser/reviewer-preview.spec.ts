import {test,expect} from '@playwright/test';
import { respond, type Mode } from './reviewer-preview-fixture';
async function begin(page:import('@playwright/test').Page) {await page.goto('/');await page.getByLabel('你想做什么？').fill('受控审查预览');await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();}
// Keyboard activation avoids the documented opaque-frame first-pointer hit-test race.
for(const mode of ['minor','major'] as const) test(`${mode}: findings survive preview, automatic save and reopen; two repairs stop after three artifacts`,async({page})=>{
  let calls=0;await page.route('**/api/generate',r=>{calls++;return respond(r,mode)});
  await begin(page);await expect(page.locator('iframe')).toBeVisible();await expect(page.getByLabel('追加修改需求')).toBeEnabled();
  await expect(page.getByText(/代码审查：有待修复问题/)).toBeVisible();
  await expect(page.getByText(/实现工程师 · 交付/)).toHaveCount(mode==='major'?3:1);
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();await page.reload();
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');await expect(page.getByText(/代码审查：有待修复问题/)).toBeVisible();expect(calls).toBe(1);
});
test('unavailable review keeps a restorable draft, truthful failure, and explicit first use without trial data',async({page})=>{
  await page.route('**/api/generate',r=>respond(r,'unknown'));await begin(page);
  await expect(page.getByText('执行失败',{exact:true})).toBeVisible();await expect(page.getByText(/审查未完成，代码已保留/)).toBeVisible();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  const stored=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('atoms-projects');r.onsuccess=()=>resolve(r.result)});const p=await new Promise<Record<string,{html:string}>>(resolve=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result.find((p: { id: string }) => p.id === new URLSearchParams(location.search).get("project")))});db.close();return p;});
  expect(stored.result.html).not.toContain('saveState');expect(stored.draftResult.html).toContain('saveState');
  await page.reload();await expect(page.getByRole('button',{name:'使用此版本'})).toBeEnabled();await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');
  await page.getByRole('button',{name:'使用此版本'}).click();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');
  await page.reload();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.getByText('执行失败',{exact:true})).toBeVisible();
});
test('data-risk candidate is visible but cannot be adopted, including after unavailable rereview; actual resolution unlocks adoption',async({page})=>{
  let mode:Mode='clean';await page.route('**/api/generate',r=>respond(r,mode));await begin(page);
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
  const change=async(m:Mode)=>{mode=m;await page.getByLabel('追加修改需求').fill(m);await page.getByRole('button',{name:'生成候选',exact:true}).click();};
  await change('data');await expect(page.getByText('第 1 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');await expect(page.frameLocator('iframe').locator('output')).toHaveText('4');
  await change('unknown');await expect(page.getByText('第 2 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();
  await change('resolved');await expect(page.getByText('第 3 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  await page.reload();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');await expect(page.getByText('执行失败',{exact:true})).toBeVisible();
});
test('platform execution blocker does not mount even with model approval; code can be restored and modified',async({page})=>{
  await page.route('**/api/generate',r=>respond(r,'fatal'));await begin(page);await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'无条件空循环'})).toBeVisible();await expect(page.getByLabel('追加修改需求')).toBeEnabled();
  await page.reload();await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'无条件空循环'})).toBeVisible();
});
