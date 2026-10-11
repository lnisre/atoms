// Deferred to #74: real DOM/iframe/source interactions, synthetic Auth/BFF.
// SQL history semantics run separately in cloud-history-sql.test.ts.
// Wait for actual mouse hit testing in the fresh opaque frame before activating.
// No synthetic DOM click, forced action, keyboard substitution or click retry.
async function pointerClick(button:Locator) {
 let offset=2;
 await expect.poll(async()=>{ await button.hover({position:{x:offset++%6+2,y:5}}); return button.evaluate(el=>el.matches(':hover')); }).toBe(true);
 await button.click();
}
import { test, expect, type Locator } from "@playwright/test";
import { fixture, generate, frame, ready, modify } from "../helpers/cloud-browser-fixture";
import type { HistoryEntry, HistorySnapshot } from "../../src/lib/cloud-projects/contract";

test('historical source, label and preview agree; returning preserves the candidate trial and original point',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await pointerClick(frame(page).getByRole('button',{name:'增加',exact:true}));await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 const original=structuredClone([...store.rows.values()][0].cloud),id=original.project.id;
 const entry:HistoryEntry={id:crypto.randomUUID(),sequence:1,origin:'initial',recordId:null,summary:'初始计数器',pairedAt:'2026-10-11T01:00:00.000Z',dataSavedAt:'2026-10-11T00:59:00.000Z',hasData:true,nextSequence:2,status:'available'};
 const snapshot:HistorySnapshot={projectId:id,entry,project:original.project,state:original.state,hasData:true};
 const current={...entry,id:crypto.randomUUID(),sequence:2,nextSequence:null,status:'current' as const,origin:'adopted' as const,summary:'第二版计数器'};
 await context.route('**/api/projects/*/history**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/history')?{projectId:id,version:{code:2,data:2},currentId:current.id,entries:[current,entry]}:snapshot}));
 await modify(page);await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(frame(page).getByRole('heading',{name:'Counter 2'})).toBeVisible();
 await modify(page);await pointerClick(frame(page).getByRole('button',{name:'增加',exact:true}));await expect(frame(page).locator('#count')).toHaveText('2');
 const calls=store.calls();await page.getByRole('button',{name:'历史保存点',exact:true}).click();
 await expect(page.getByText('采用 V2 前配对保存',{exact:false})).toBeVisible();await page.getByRole('button',{name:'试用 V1 副本'}).click();
 await expect(frame(page).getByRole('heading',{name:'Counter 1'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('1');
 await expect(page.getByText('历史 V1 · 副本试用',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toContainText('Counter 1');await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).not.toContainText('Counter 3');
 await page.getByRole('button',{name:'预览',exact:true}).click();await pointerClick(frame(page).getByRole('button',{name:'增加',exact:true}));await expect(frame(page).locator('#count')).toHaveText('2');
 expect(store.rows.get(id)!.cloud.state).toEqual({count:1});expect(snapshot.state).toEqual({count:1});
 await page.getByRole('button',{name:'返回候选试用'}).click();await expect(frame(page).getByRole('heading',{name:'Counter 3'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('2');
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toContainText('Counter 3');
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'试用 V1 副本'}).click();await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toContainText('Counter 1');
 await page.getByRole('button',{name:'预览',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');expect(store.calls()).toBe(calls);
 await expect(page.getByRole('button',{name:'恢复到 V1',exact:true})).toBeDisabled();
});

test('failed history read reports failure without mounting an empty history preview',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await context.route('**/api/projects/*/history',route=>route.fulfill({status:503,json:{code:'unavailable',error:'历史读取失败，请重试。'}}));
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'历史读取失败'})).toBeVisible();
 await expect(page.getByRole('button',{name:/试用 V/})).toHaveCount(0);await expect(frame(page).getByRole('heading',{name:'Counter 1'})).toBeVisible();
 expect(store.calls()).toBe(1);await page.getByRole('button',{name:'返回当前项目'}).click();await expect(page.getByRole('button',{name:'生成候选'})).toBeVisible();
});

async function adopted(page:import('@playwright/test').Page) {
 await modify(page);await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);
}
async function increment(page:import('@playwright/test').Page) {
 await pointerClick(frame(page).getByRole('button',{name:'增加',exact:true}));await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
}
async function restore(page:import('@playwright/test').Page,version=1) {
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:`恢复到 V${version}`,exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('替换当前业务数据');await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect(page.getByRole('button',{name:'撤销本次恢复',exact:true})).toBeEnabled();
}
test('direct restore, cancel, paired original, source and persistent full undo agree across independent sessions',async({page,context,browser})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await increment(page);await increment(page);await adopted(page);await increment(page);await adopted(page);
 const id=[...store.rows.keys()][0],before=structuredClone(store.rows.get(id)!.cloud),calls=store.calls();
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'恢复到 V1',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();expect(store.rows.get(id)!.cloud).toEqual(before);
 await page.getByRole('button',{name:'试用 V1 副本'}).click();await expect(frame(page).locator('#count')).toHaveText('2');await incrementTrial(page);
 await page.getByRole('button',{name:'恢复到 V1',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect(frame(page).getByRole('heading',{name:'Counter 1'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('2');
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toContainText('Counter 1');
 await page.reload();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();expect(store.calls()).toBe(calls);
 const other=await browser.newContext();await store.connect(other);const second=await other.newPage();await second.goto(`/?project=${id}`);
 await expect(second.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();await second.close();const reopened=await other.newPage();await reopened.goto(`/?project=${id}`);
 await expect(reopened.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();await other.close();
 await increment(page);await modify(page);await incrementTrial(page);
 await page.getByRole('button',{name:'撤销本次恢复'}).click();await expect(page.getByRole('dialog')).toContainText('当前未采用候选');await expect(page.getByRole('dialog')).toContainText('不进行合并');
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'撤销本次恢复'}).click();await page.getByRole('button',{name:'确认撤销恢复',exact:true}).click();
 await expect(frame(page).getByRole('heading',{name:'Counter 3'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('3');
 await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'撤销本次恢复'})).toHaveCount(0);
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toContainText('Counter 3');
 expect(store.rows.get(id)!.cloud.project.modificationRecords).toEqual(before.project.modificationRecords);expect(store.calls()).toBe(calls+1);
});
async function incrementTrial(page:import('@playwright/test').Page) {await pointerClick(frame(page).getByRole('button',{name:'增加',exact:true}));await expect(frame(page).locator('#status')).toHaveText('更新完成');}

test('lost restore response and failed undo readback retain original operation; cleanup protection ends only on adoption',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await adopted(page);await adopted(page);
 const id=[...store.rows.keys()][0];store.loseHistory();await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'恢复到 V2',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect(page.getByRole('button',{name:'重试原保存'})).toBeEnabled();await page.getByRole('button',{name:'重试原保存'}).click();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();
 const historyBodies=store.bodies.filter((b):b is {action:string;operationId:string}=>!!b&&typeof b==='object'&&'action' in b);expect(historyBodies[0]).toEqual(historyBodies[1]);
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('button',{name:'清理 V1 保存点'})).toBeDisabled();
 await page.getByRole('button',{name:'返回当前项目'}).click();store.failReadback();await page.getByRole('button',{name:'撤销本次恢复'}).click();await page.getByRole('button',{name:'确认撤销恢复'}).click();
 await expect(page.getByRole('alert').filter({hasText:'提交后回读失败'})).toBeVisible();await page.getByRole('button',{name:'重试原保存'}).click();await expect(frame(page).getByRole('heading',{name:'Counter 3'})).toBeVisible();
 await restore(page,2);await modify(page);await expect(page.getByText('采用后将结束本次恢复的撤销机会',{exact:false})).toBeVisible();await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toHaveCount(0);
 const records=structuredClone(store.rows.get(id)!.cloud.project.modificationRecords);
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'清理 V1 保存点'}).click();await expect(page.getByRole('dialog')).toContainText('永久删除');await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'清理 V1 保存点'}).click();await page.getByRole('button',{name:'永久清理保存点'}).click();await page.getByRole('button',{name:'历史保存点',exact:true}).click();
 await expect(page.getByRole('heading',{name:'V1 · 已清理，无法恢复'})).toBeVisible();await expect(page.getByRole('button',{name:'试用 V1 副本'})).toHaveCount(0);expect(store.rows.get(id)!.cloud.project.modificationRecords).toEqual(records);
 await page.reload();await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('heading',{name:'V1 · 已清理，无法恢复'})).toBeVisible();
});

test('capacity failure leads to actual manual cleanup and keeps the candidate; stale confirmation reports conflict',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await adopted(page);await adopted(page);
 const id=[...store.rows.keys()][0],before=structuredClone(store.rows.get(id)!.cloud);
 store.failHistory(507);await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'恢复到 V2',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'云端空间不足'})).toBeVisible();expect(store.rows.get(id)!.cloud).toEqual(before);await page.getByRole('button',{name:'查看可清理保存点'}).click();
 await page.getByRole('button',{name:'返回当前项目'}).click();await modify(page);await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('button',{name:'恢复到 V2',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'清理 V1 保存点'}).click();await page.getByRole('button',{name:'永久清理保存点'}).click();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'放弃本轮修改'}).click();await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'恢复到 V2',exact:true}).click();
 store.rows.get(id)!.cloud.version.data++;await page.getByRole('button',{name:'确认恢复',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'重新核对'})).toBeVisible();await expect(page.getByRole('button',{name:'重新载入并核对'})).toBeVisible();
});

test('undo has no clock expiry, busy generation blocks it, discard retains it and failed cleanup does not claim success',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await adopted(page);await adopted(page);await restore(page,2);
 await page.clock.install({time:new Date('2099-01-01T00:00:00Z')});await page.reload();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();
 store.holdGeneration();await page.getByLabel('追加修改需求').fill('pending candidate');await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeDisabled();store.releaseGeneration();
 await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();await page.getByRole('button',{name:'放弃本轮修改'}).click();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toBeEnabled();
 await page.getByRole('button',{name:'撤销本次恢复'}).click();await page.getByRole('button',{name:'确认撤销恢复'}).click();await expect(page.getByRole('button',{name:'撤销本次恢复'})).toHaveCount(0);
 store.failHistory();await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'清理 V1 保存点'}).click();await page.getByRole('button',{name:'永久清理保存点'}).click();
 await expect(page.getByRole('alert').filter({hasText:'原状态保留'})).toBeVisible();await expect(page.getByRole('heading',{name:'V1 · 已清理，无法恢复'})).toHaveCount(0);await page.getByRole('button',{name:'重试原保存'}).click();await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('heading',{name:'V1 · 已清理，无法恢复'})).toBeVisible();
});
