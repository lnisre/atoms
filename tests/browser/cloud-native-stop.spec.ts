import { test, expect, type Page } from '@playwright/test';

// Real gateway, Next handlers, supervised Python and existing scripted model.
// Auth/PG provider is tests/helpers/offline-cloud-provider.mjs, not real cloud.
test.describe('native cloud cancellation with offline provider',()=>{
 test.skip(process.env.TEAM_FIXTURE!=='1','Requires owned gateway and explicit offline providers');
 test.setTimeout(120000);
 async function login(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
  await page.getByLabel('邮箱地址',{exact:true}).fill('synthetic@example.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();await page.getByLabel('6 位验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并登录'}).click();await expect(page.getByText('synthetic@example.invalid',{exact:true})).toBeVisible();
 }
 function observe(page:Page){
  const errors:string[]=[],sockets:{reviews:number;artifacts:number;terminals:number;closed:boolean;afterClose:number}[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>{
   if(!ws.url().endsWith('/api/team/socket'))return;
   const row={reviews:0,artifacts:0,terminals:0,closed:false,afterClose:0};sockets.push(row);
   ws.on('framereceived',frame=>{if(row.closed)row.afterClose++;const m=JSON.parse(String(frame.payload));if(m.type==='artifact')row.artifacts++;if(m.type==='call'&&m.call.actor==='Reviewer'&&m.call.status==='started')row.reviews++;if(m.type==='result')row.terminals++;});ws.on('close',()=>{row.closed=true;});
  });return {errors,sockets};
 }
 async function snapshot(page:Page){
  const headers={'X-Atoms-Account':'synthetic-account'};
  const list=await page.request.get('/api/projects',{headers});expect(list.ok()).toBe(true);
  const projects=await list.json();const rows=[];for(const p of projects){const r=await page.request.get('/api/projects/'+p.id,{headers});expect(r.ok()).toBe(true);rows.push(await r.json());}return rows;
 }
 for(const modification of [false,true])test(`${modification?'modification':'first generation'} stop after cached repair rejects late result`,async({page},info)=>{
  await login(page);const observations=observe(page);
  if(modification){
   await page.getByLabel('你想做什么？').fill('受控计数器');await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.getByText('云端已保存代码',{exact:false})).toBeVisible({timeout:65000});
   const button=page.frameLocator('iframe').getByRole('button',{name:'增加',exact:true});await button.hover();await expect.poll(()=>button.evaluate(el=>el.matches(':hover'))).toBe(true);await button.click();await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
  }
  const before=await snapshot(page),iframe=modification?await page.locator('iframe').elementHandle():undefined;
  if(modification){await page.getByLabel('追加修改需求').fill('一次修复 停止返工');await page.getByRole('button',{name:'生成候选',exact:true}).click();}
  else {await page.getByLabel('你想做什么？').fill('一次修复 停止返工');await page.getByRole('button',{name:'开始生成',exact:true}).click();}
  const index=modification?1:0;await expect.poll(()=>observations.sockets[index]?.reviews,{timeout:65000}).toBe(2);expect(observations.sockets[index].artifacts).toBeGreaterThan(0);
  await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.getByRole('region',{name:'生成进度',exact:true})).toContainText('任务已停止');await expect.poll(()=>observations.sockets[index].closed).toBe(true);
  await page.waitForTimeout(32000);expect(await snapshot(page)).toEqual(before);expect(observations.sockets[index].terminals).toBe(0);expect(observations.sockets[index].afterClose).toBe(0);expect(observations.errors).toEqual([]);
  if(modification){expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');}else await expect(page.locator('iframe')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('stopped.png')});await page.reload();expect(await snapshot(page)).toEqual(before);expect(observations.sockets).toHaveLength(modification?2:1);
  await info.attach('native-stop',{body:JSON.stringify({before,after:await snapshot(page),...observations,observationMs:32000}),contentType:'application/json'});
 });
});
