// Deferred to #74: real DOM/iframe/source interactions, synthetic Auth/BFF.
// SQL history semantics run separately in cloud-history-sql.test.ts.
import { test, expect } from "@playwright/test";
import { fixture, generate, frame, ready, modify } from "../helpers/cloud-browser-fixture";
import type { HistoryEntry, HistorySnapshot } from "../../src/lib/cloud-projects/contract";

test('historical source, label and preview agree; returning preserves the candidate trial and original point',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 const original=structuredClone([...store.rows.values()][0].cloud),id=original.project.id;
 const entry:HistoryEntry={id:crypto.randomUUID(),sequence:1,origin:'initial',recordId:null,summary:'初始计数器',pairedAt:'2026-10-11T01:00:00.000Z',dataSavedAt:'2026-10-11T00:59:00.000Z',hasData:true,nextSequence:2,status:'available'};
 const snapshot:HistorySnapshot={projectId:id,entry,project:original.project,state:original.state,hasData:true};
 const current={...entry,id:crypto.randomUUID(),sequence:2,nextSequence:null,status:'current' as const,origin:'adopted' as const,summary:'第二版计数器'};
 await context.route('**/api/projects/*/history**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/history')?{projectId:id,version:{code:2,data:2},currentId:current.id,entries:[current,entry]}:snapshot}));
 await modify(page);await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(frame(page).getByRole('heading',{name:'Counter 2'})).toBeVisible();
 await modify(page);await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('2');
 const calls=store.calls();await page.getByRole('button',{name:'历史保存点',exact:true}).click();
 await expect(page.getByText('采用 V2 前配对保存',{exact:false})).toBeVisible();await page.getByRole('button',{name:'试用 V1 副本'}).click();
 await expect(frame(page).getByRole('heading',{name:'Counter 1'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('1');
 await expect(page.getByText('历史 V1 · 副本试用',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.locator('pre')).toContainText('Counter 1');await expect(page.locator('pre')).not.toContainText('Counter 3');
 await page.getByRole('button',{name:'预览',exact:true}).click();await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('2');
 expect(store.rows.get(id)!.cloud.state).toEqual({count:1});expect(snapshot.state).toEqual({count:1});
 await page.getByRole('button',{name:'返回候选试用'}).click();await expect(frame(page).getByRole('heading',{name:'Counter 3'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('2');
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await expect(page.locator('pre')).toContainText('Counter 3');
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'试用 V1 副本'}).click();await expect(page.locator('pre')).toContainText('Counter 1');
 await page.getByRole('button',{name:'预览',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');expect(store.calls()).toBe(calls);
 await expect(page.getByRole('button',{name:/恢复到|撤销恢复|清理保存点/})).toHaveCount(0);
});

test('failed history read reports failure without mounting an empty history preview',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await context.route('**/api/projects/*/history',route=>route.fulfill({status:503,json:{code:'unavailable',error:'历史读取失败，请重试。'}}));
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'历史读取失败'})).toBeVisible();
 await expect(page.getByRole('button',{name:/试用 V/})).toHaveCount(0);await expect(frame(page).getByRole('heading',{name:'Counter 1'})).toBeVisible();
 expect(store.calls()).toBe(1);await page.getByRole('button',{name:'返回当前项目'}).click();await expect(page.getByRole('button',{name:'生成候选'})).toBeVisible();
});
