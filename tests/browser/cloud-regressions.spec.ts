import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, test, expect } from '@playwright/test';
import { fixture, generate, ready, frame, modify } from '../helpers/cloud-browser-fixture';

test('first pointer activation reaches a freshly restored opaque iframe',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 for(let attempt=0;attempt<6;attempt++){
  if(attempt)await page.reload();
  const button=frame(page).getByRole('button',{name:'增加',exact:true});await expect(button).toBeEnabled();
  await page.evaluate(()=>{(window as unknown as {pointerLog:unknown[]}).pointerLog=[];for(const type of ['pointerdown','pointerup','click'])addEventListener(type,e=>(window as unknown as {pointerLog:unknown[]}).pointerLog.push({type,target:(e.target as Element).tagName}),true);});
  await button.click();
  try{await expect(frame(page).locator('#count')).toHaveText(String(attempt+1),{timeout:2000});}
  finally{await info.attach(`pointer-${attempt}`,{body:JSON.stringify(await page.evaluate(()=>(window as unknown as {pointerLog:unknown[]}).pointerLog)),contentType:'application/json'});}
  await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 }
});

test('cloud candidate preserves code reading and same-version iframe across view changes',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await page.getByRole('button',{name:'查看代码',exact:true}).click();
 await page.getByRole('searchbox',{name:'在当前文件中搜索'}).fill('Counter');
 await modify(page);
 await expect(page.getByRole('region',{name:'源码 index.html',exact:true})).toBeVisible();
 await expect(page.getByRole('searchbox',{name:'在当前文件中搜索'})).toHaveValue('Counter');
 await page.getByRole('button',{name:'预览',exact:true}).click();
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');
 const iframe=await page.locator('iframe').elementHandle();
 await page.getByRole('button',{name:'查看代码',exact:true}).click();await page.getByRole('button',{name:'预览',exact:true}).click();
 expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);await expect(frame(page).locator('#count')).toHaveText('1');
 await page.setViewportSize({width:736,height:900});
 const history=await page.locator('.cloud-project-history').boundingBox(),result=await page.getByRole('region',{name:'项目成果'}).boundingBox();
 expect(result!.x).toBeGreaterThanOrEqual(history!.x+history!.width-1);
 await page.screenshot({path:info.outputPath('cloud-narrow.png')});
});

test('failed and stopped modifications retain the candidate; discard and refresh keep only saved state',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await modify(page);
 await frame(page).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(page).locator('#count')).toHaveText('1');
 store.failGeneration();await page.getByLabel('追加修改需求').fill('retain this failed input');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'synthetic generation unavailable'})).toBeVisible();await expect(page.getByLabel('追加修改需求')).toHaveValue('retain this failed input');await expect(frame(page).locator('#count')).toHaveText('1');
 store.holdGeneration();await page.getByRole('button',{name:'生成候选',exact:true}).click();await page.getByRole('button',{name:'停止生成',exact:true}).click();
 await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeEnabled();store.releaseGeneration();await expect(frame(page).locator('h1')).toHaveText('Counter 2');
 await page.getByRole('button',{name:'放弃本轮修改',exact:true}).click();await expect(frame(page).locator('h1')).toHaveText('Counter 1');await expect(frame(page).locator('#count')).toHaveText('0');
 await modify(page);await page.reload();await expect(frame(page).locator('h1')).toHaveText('Counter 1');await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);expect(store.rows.size).toBe(1);
});

test('a result without a trusted terminal proof stays downloadable and cannot be saved',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.withoutProof();await generate(page);
 await expect(page.getByRole('alert').filter({hasText:'未取得可信保存证明'})).toBeVisible();expect(store.rows.size).toBe(0);expect(store.bodies).toHaveLength(0);
 await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'重试原保存'})).toHaveCount(0);
 const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'下载未保存副本',exact:true}).click();const download=await waiting;
 const raw=readFileSync((await download.path())!,'utf8');expect(raw).toContain('Counter 1');expect(JSON.parse(raw).savedToCloud).toBe(false);expect(raw).not.toMatch(/signature|accessToken|ATOMS_ARTIFACT/);
});

test('long saved history scrolls independently and leaves modification controls and preview reachable',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 const row=[...store.rows.values()][0];row.cloud.project.requirement='Synthetic long requirement\n'.repeat(150);row.cloud.project.initialGeneration!.assistantReply='Synthetic long assistant reply\n'.repeat(100);await page.reload();
 await page.getByLabel('追加修改需求').fill('preserve my input');
 const history=page.getByRole('region',{name:'项目对话与详情'});
 for(const width of [1440,1280,736]){
  const height=width===1280?720:900;await page.setViewportSize({width,height});await history.focus();await page.keyboard.press('Home');
  await expect(page.getByRole('button',{name:'回到最新消息 ↓'})).toBeVisible();
  for(const control of [page.getByLabel('追加修改需求'),page.getByRole('button',{name:'生成候选',exact:true})]){const box=(await control.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(height);}
  await page.getByRole('button',{name:'回到最新消息 ↓'}).click();await expect(page.getByLabel('追加修改需求')).toHaveValue('preserve my input');await expect(frame(page).locator('#count')).toHaveText('0');
  await page.screenshot({path:info.outputPath(`history-${width}.png`)});
 }
 expect(store.calls()).toBe(1);
});

test('a complete Chrome restart restores the cloud project without another generation request',async({baseURL})=>{
 const store=await fixture();const profile=mkdtempSync(join(tmpdir(),'atoms69-profile-'));
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].flatMap(k=>process.env[k]?[[k,process.env[k]!]]:[]));
 let context=await chromium.launchPersistentContext(profile,{channel:'chrome',baseURL,env});
 try{
  await store.connect(context);const p=await context.newPage();await generate(p);await expect(ready(p)).toBeVisible();
  await frame(p).getByRole('button',{name:'增加',exact:true}).click();await expect(frame(p).locator('#count')).toHaveText('1');await expect(p.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();const url=p.url();
  await context.close();context=await chromium.launchPersistentContext(profile,{channel:'chrome',baseURL,env});await store.connect(context);const reopened=await context.newPage();await reopened.goto(url);
  await expect(frame(reopened).locator('#count')).toHaveText('1');expect(store.calls()).toBe(1);await expect(reopened.getByRole('region',{name:'首次生成记录'})).toBeVisible();
 }finally{await context.close();rmSync(profile,{recursive:true,force:true});}
});
