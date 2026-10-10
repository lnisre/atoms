import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fixture, login, generate, frame, ready, modify } from "../helpers/cloud-browser-fixture";
test('guest intent runs once; first save response loss and separate log failure retry without generation; second browser restores',async({page,context,browser})=>{
 const store=await fixture();await store.connect(context,'owner-a',false);store.loseSave();await generate(page);await login(page);
 await expect(page.getByRole('button',{name:'重试原保存'})).toBeEnabled();expect(store.calls()).toBe(1);expect(store.rows.size).toBe(1);
 store.failLogs(true);await page.getByRole('button',{name:'重试原保存'}).click();await expect(ready(page)).toBeVisible();
 await expect(page.getByText('代码已保存；云端提交步骤日志尚未确认，可单独重试。')).toBeVisible();expect(store.bodies[0]).toEqual(store.bodies[1]);
 store.failLogs(false);await page.getByRole('button',{name:'重试记录保存'}).click();await expect(page.getByRole('button',{name:'重试记录保存'})).toHaveCount(0);
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 const second=await browser.newContext();try{await store.connect(second);const p=await second.newPage();await p.goto(page.url());await expect(frame(p).locator('#count')).toHaveText('1');expect(store.calls()).toBe(1);}finally{await second.close();}
});
test('multi-round trial never writes official data; atomic adoption replays and other device candidate conflicts',async({page,context,browser},info)=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 const other=await browser.newContext();try{
  await store.connect(other);const p=await other.newPage();await p.goto(page.url());await expect(ready(p)).toBeVisible();await modify(p);
  await modify(page);await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('2');expect([...store.rows.values()][0].cloud.state).toEqual({count:1});
  await modify(page);expect(store.calls()).toBe(4);store.loseSave();await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByRole('button',{name:'重试原保存'})).toBeEnabled();
  await page.getByRole('button',{name:'重试原保存'}).click();await expect(ready(page)).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('1');expect([...store.rows.values()][0].cloud.project.modificationRecords).toHaveLength(1);
  await p.getByRole('button',{name:'采用修改',exact:true}).click();await expect(p.getByRole('alert').filter({hasText:'云端已有更新'})).toBeVisible();await p.screenshot({path:info.outputPath('candidate-conflict.png'),fullPage:true});
  const waiting=p.waitForEvent('download');await p.getByRole('button',{name:'下载未保存副本',exact:true}).first().click();const file=await waiting;const copy=JSON.parse(readFileSync((await file.path())!,'utf8'));expect(copy.savedToCloud).toBe(false);expect(copy.modificationRecords[0].generations).toHaveLength(1);expect(JSON.stringify(copy)).not.toMatch(/signature|accessToken|ATOMS_ARTIFACT/);
 }finally{await other.close();}
});
test('natural expiry retains started result; same-account reauthentication saves without another model task',async({page,context})=>{
 const store=await fixture(),auth=await store.connect(context);store.holdGeneration();await generate(page);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
 auth.expire();store.releaseGeneration();await expect(page.getByRole('alert').filter({hasText:'登录已失效'})).toBeVisible();expect(store.rows.size).toBe(0);
 await page.getByRole('button',{name:'重新登录原账号',exact:true}).click();await login(page);await page.getByRole('button',{name:'重试原保存'}).click();await expect(ready(page)).toBeVisible();expect(store.calls()).toBe(1);
});
test('cancelled exit keeps task; confirmed logout unmounts and ignores late result before another account signs in',async({page,context})=>{
 const store=await fixture(),auth=await store.connect(context);store.holdGeneration();await generate(page);await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
 await page.getByRole('button',{name:'退出登录'}).click();await page.getByRole('button',{name:'留在页面'}).click();await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
 await page.getByRole('button',{name:'退出登录'}).click();await page.getByRole('button',{name:'仍要退出登录'}).click();await expect(page.getByRole('button',{name:'登录 / 注册'})).toBeVisible();
 auth.switchTo('owner-b');await page.getByRole('button',{name:'登录 / 注册'}).click();await login(page,'owner-b');store.releaseGeneration();await expect(page.getByText('owner-b@example.invalid',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);expect(store.rows.size).toBe(0);
});
test('restored restricted code remains trial; explicit permitted activation never copies trial data',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.restrict({status:'allowed',reasons:[],dataMode:'trial',adoption:'allowed',review:'unavailable'});await generate(page);await expect(ready(page)).toBeVisible();
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');expect([...store.rows.values()][0].cloud.state).toBe(null);
 await page.reload();await expect(page.getByRole('button',{name:'使用此版本'})).toBeEnabled();await expect(frame(page).locator('#count')).toHaveText('0');await page.getByRole('button',{name:'使用此版本'}).click();await expect(page.getByRole('button',{name:'使用此版本'})).toHaveCount(0);await expect(frame(page).locator('#count')).toHaveText('0');
});

test('logout during uncertain commit clears old page; late commit remains private to the original account',async({page,context})=>{
 const store=await fixture(),auth=await store.connect(context);store.holdSave();await generate(page);
 await expect(page.getByRole('button',{name:'重试原保存'})).toBeDisabled();await expect(page.locator('iframe')).toHaveCount(1);
 await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByRole('dialog').getByRole('button',{name:'下载未保存副本'})).toBeVisible();
 await page.getByRole('button',{name:'仍要退出登录'}).click();await expect(page.locator('iframe')).toHaveCount(0);
 // The old request was already authorized. A commit may finish after exit; the
 // disposed page must not read it back, display it, or save under a new owner.
 store.releaseSave();await expect.poll(()=>store.rows.size).toBe(1);
 auth.switchTo('owner-b');await page.getByRole('button',{name:'登录 / 注册'}).click();await login(page,'owner-b');await expect(page.getByText('owner-b@example.invalid',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
 expect([...store.rows.values()][0].owner).toBe('owner-a');await expect(page.getByRole('button',{name:'Synthetic counter',exact:true})).toHaveCount(0);
});
test('execution-blocked draft remains blocked after reopening and cannot be activated by the page',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.restrict({status:'blocked',reasons:['synthetic execution blocker'],dataMode:'trial',adoption:'blocked',review:'issues'});await generate(page);await expect(ready(page)).toBeVisible();
 await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('button',{name:'使用此版本'})).toBeDisabled();await page.reload();await expect(page.getByText('synthetic execution blocker')).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
});

test('first generation failure preserves editable requirement and explicitly starts a fresh task',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.failGeneration();await generate(page);
 await expect(page.getByRole('alert').filter({hasText:'synthetic generation unavailable'})).toBeVisible();await expect(page.getByLabel('补充生成需求')).toHaveValue('Synthetic counter');
 await page.getByLabel('补充生成需求').fill('Synthetic counter with reset');await page.getByRole('button',{name:'重新生成',exact:true}).click();await page.getByRole('button',{name:'仍要开始新任务'}).click();await expect(ready(page)).toBeVisible();expect(store.calls()).toBe(2);
});
test('restored restricted trial changes trigger exit protection and download includes the session copy',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.restrict({status:'allowed',reasons:[],dataMode:'trial',adoption:'blocked',review:'issues'});await generate(page);await expect(ready(page)).toBeVisible();await page.reload();
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');await page.getByRole('button',{name:'退出登录'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();const waiting=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载未保存副本'}).click();const file=await waiting;expect(JSON.parse(readFileSync((await file.path())!,'utf8')).trialState).toEqual({count:1});await dialog.getByRole('button',{name:'留在页面'}).click();await expect(frame(page).locator('#count')).toHaveText('1');expect([...store.rows.values()][0].cloud.state).toBe(null);
});
