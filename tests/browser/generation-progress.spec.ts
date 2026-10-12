import { test, expect } from '@playwright/test';
import { fixture, ready, frame, modify } from '../helpers/cloud-browser-fixture';
import { progressFixture } from '../helpers/progress-browser-fixture';
import { TEAM_TIMEOUT_MS } from '../../src/lib/team/contract';
async function generate(page:import('@playwright/test').Page) {
 await page.goto('/');await expect(page.getByText('owner-a@example.invalid',{exact:true})).toBeVisible();
 await page.getByLabel('你想做什么？').fill('Synthetic counter');await page.getByRole('button',{name:'开始生成',exact:true}).click();
}
const summary=(page:import('@playwright/test').Page)=>page.getByRole('region',{name:'生成进度',exact:true});
async function add(page:import('@playwright/test').Page) {
 const button=frame(page).getByRole('button',{name:'增加',exact:true});
 await button.hover();await expect(button).toHaveJSProperty('disabled',false);await expect.poll(()=>button.evaluate(el=>el.matches(':hover'))).toBe(true);await button.click();
}
const stage=(page:import('@playwright/test').Page,name:string)=>summary(page).getByRole('listitem').filter({hasText:name});

test('first generation follows accepted deliveries, both repairs and current-code review; time freezes before saving',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);store.holdSave();const stream=await progressFixture(page,store);
 await page.clock.install();await generate(page);await stream.connected();
 await expect(summary(page)).toContainText('正在建立生成连接');await expect(summary(page)).toContainText(`执行上限 ${TEAM_TIMEOUT_MS/60000} 分钟`);
 stream.assign('Requirements');stream.call('Requirements');await expect(summary(page).getByRole('status')).toHaveText('整理需求 · 进行中');
 stream.completed();await expect(stage(page,'整理需求')).toContainText('进行中');
 stream.delivery('Requirements',{requirements:[{id:'counter'}]});await expect(stage(page,'整理需求')).toContainText('已完成');
 stream.engineerStart();await expect(summary(page).getByRole('status')).toHaveText('编写应用 · 进行中');
 await page.clock.runFor(5000);stream.engineerDeliver();await expect(stage(page,'编写应用')).not.toContainText('已完成');
 stream.artifact();await expect(stage(page,'编写应用')).toContainText('已完成');await expect(page.locator('iframe')).toHaveCount(0);
 for(let repair=1;repair<=2;repair++){
  stream.reviewerStart();stream.review(true);await expect(stage(page,'代码审查')).toContainText('已完成');
  stream.call('Mike');await expect(stage(page,'整理需求')).toContainText('已完成');stream.completed();stream.delivery('Mike',{command:'assign',to:'Engineer'});stream.call('Engineer');
  await expect(summary(page)).toContainText(`第 ${repair} 次／最多 2 次`);await expect(summary(page)).toContainText('修复完成后需要复审');await expect(stage(page,'代码审查')).not.toContainText('已完成');
  await page.clock.runFor(5000);stream.engineerDeliver(repair+1);stream.artifact();await expect(summary(page)).toContainText('新代码仍需复审');
 }
 stream.reviewerStart();stream.review();stream.finish();await expect(summary(page)).toContainText('正在保存项目');
 const time=await summary(page).locator('.generation-progress-heading').textContent();await page.clock.runFor(5000);await expect(summary(page).locator('.generation-progress-heading')).toHaveText(time!);
 await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);await expect(summary(page)).not.toContainText('可试用');
 store.releaseSave();await expect(ready(page)).toBeVisible();await expect(summary(page)).toContainText('代码已保存 · 预览已加载');
 await page.screenshot({path:info.outputPath('first-complete.png')});expect(stream.calls()).toBe(1);
 await page.reload();await expect(summary(page)).toHaveCount(0);expect(stream.calls()).toBe(1);
});

test('30 second threshold excludes heartbeat and data edits; fresh progress clears wait; stop freezes elapsed and next task resets',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);const stream=await progressFixture(page,store,false);await generate(page);await expect(ready(page)).toBeVisible();
 stream.enable();await page.clock.install();await page.getByLabel('追加修改需求').fill('waiting input');await page.getByRole('button',{name:'生成候选',exact:true}).click();await stream.connected();stream.assign('Requirements');stream.call('Requirements');
 await expect(summary(page)).toContainText('整理需求 · 进行中');
 // Give heartbeat acknowledgments an event-loop turn at each controlled tick.
 for(let i=0;i<7;i++){await page.clock.runFor(4000);await expect.poll(()=>stream.heartbeats()).toBe(i+1);}
 await page.clock.runFor(1000);await expect(summary(page)).not.toContainText('仍在等待模型响应');
 await add(page);await expect(frame(page).locator('#count')).toHaveText('1');
 await page.clock.runFor(1000);await expect(summary(page)).toContainText('仍在等待模型响应，最近一次进展在 30 秒前');
 await page.screenshot({path:info.outputPath('long-wait.png')});stream.completed();await expect(summary(page)).not.toContainText('仍在等待模型响应');
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(summary(page)).toContainText('任务已停止');await expect(summary(page)).toContainText('本轮未交付新代码');
 const time=await summary(page).locator('.generation-progress-heading').textContent();await page.clock.runFor(4000);await expect(summary(page).locator('.generation-progress-heading')).toHaveText(time!);
 await expect(page.getByLabel('追加修改需求')).toHaveValue('waiting input');await expect(frame(page).locator('#count')).toHaveText('1');
 await page.getByRole('button',{name:'生成候选',exact:true}).click();await stream.connected();await expect(summary(page)).toContainText('已用时 0 分 0 秒');expect(stream.calls()).toBe(2);
 await page.getByRole('button',{name:'停止生成',exact:true}).click();
});

for(const width of [1440,1280])test(`modification fixed summary, scroll, details, input and iframe retention at ${width}`,async({page,context},info)=>{
 await page.setViewportSize({width,height:width===1280?720:900});const store=await fixture();await store.connect(context);const stream=await progressFixture(page,store,false);await generate(page);await expect(ready(page)).toBeVisible();
 [...store.rows.values()][0].cloud.project.requirement='Long history\n'.repeat(150);await page.reload();await expect(ready(page)).toBeVisible();await modify(page);
 await add(page);await expect(frame(page).locator('#count')).toHaveText('1');const iframe=await page.locator('iframe').elementHandle();
 stream.enable();await page.getByLabel('追加修改需求').fill('preserved draft');await page.getByRole('button',{name:'生成候选',exact:true}).click();await stream.connected();
 const history=page.getByRole('region',{name:'项目对话与详情'});await history.hover();await page.mouse.wheel(0,-100000);await expect.poll(()=>history.evaluate(el=>el.scrollTop)).toBe(0);await expect(page.getByRole('button',{name:'回到最新消息 ↓'})).toBeVisible();const top=await history.evaluate(el=>el.scrollTop);
 stream.requirements();stream.engineerStart();await expect(summary(page)).toContainText('编写应用 · 进行中');expect(await history.evaluate(el=>el.scrollTop)).toBe(top);expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);await expect(frame(page).locator('#count')).toHaveText('1');
 for(const control of [summary(page),page.getByLabel('追加修改需求'),page.getByRole('button',{name:'停止生成',exact:true})]){const box=(await control.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(width===1280?720:900);}
 await page.screenshot({path:info.outputPath(`fixed-summary-${width}.png`)});
 await page.getByRole('button',{name:'停止生成',exact:true}).click();await expect(page.getByLabel('追加修改需求')).toHaveValue('preserved draft');
 await page.getByRole('button',{name:'回到最新消息 ↓'}).click();await page.getByText('平台执行记录',{exact:true}).last().click();expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);await expect(frame(page).locator('#count')).toHaveText('1');expect(stream.calls()).toBe(1);
});

for(const outcome of ['limit','failed','clarification','unsupported'] as const)test(`terminal without code: ${outcome}`,async({page,context})=>{
 const store=await fixture();await store.connect(context);const stream=await progressFixture(page,store);await generate(page);await stream.connected();stream.requirements();stream.engineerStart();stream.fail(outcome,`Synthetic ${outcome} reason`);
 await expect(summary(page)).toContainText(`Synthetic ${outcome} reason`);await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);await expect(summary(page)).not.toContainText('仍在等待模型响应');await expect(page.getByLabel('补充生成需求')).toBeVisible();expect(store.rows.size).toBe(0);
});
for(const outcome of ['limit','failed'] as const)test(`terminal with complete code retains reason and usable artifact: ${outcome}`,async({page,context})=>{
 const store=await fixture();await store.connect(context);const stream=await progressFixture(page,store);await generate(page);await stream.connected();stream.requirements();stream.engineerStart();stream.engineerDeliver();stream.artifact();stream.reviewerStart();stream.finish(outcome,`Synthetic ${outcome} reason`);
 await expect(summary(page)).toContainText(`Synthetic ${outcome} reason`);await expect(summary(page)).toContainText('代码已保存');await expect(frame(page).locator('h1')).toHaveText('Progress 1');await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
});

test('connection failure before and after complete code reports outcome without inventing a save',async({page,context})=>{
 const store=await fixture();await store.connect(context);const stream=await progressFixture(page,store,false);await generate(page);await expect(ready(page)).toBeVisible();stream.enable();
 for(const code of [false,true]){
  await page.getByLabel('追加修改需求').fill('connection failure');await page.getByRole('button',{name:'生成候选',exact:true}).click();await stream.connected();stream.requirements();stream.engineerStart();
  if(code){stream.engineerDeliver();stream.artifact();stream.reviewerStart();await expect(stage(page,'编写应用')).toContainText('已完成');}
  stream.disconnect();await expect(summary(page)).toContainText('执行失败');await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
  if(code){await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();await expect(frame(page).locator('h1')).toHaveText('Progress 1');}else await expect(frame(page).locator('h1')).toHaveText('Counter 1');
 }
 expect(store.bodies).toHaveLength(1);
});

test('save failure and blocked or failed preview never claim ready',async({page,context})=>{
 const store=await fixture();await store.connect(context);store.loseSave();await generate(page);await expect(summary(page)).toContainText('项目保存尚未确认');await expect(summary(page)).not.toContainText('代码已保存');await expect(summary(page)).not.toContainText('可试用');
 await page.getByRole('button',{name:'重试原保存'}).click();await expect(summary(page)).toContainText('代码已保存 · 预览已加载');
 store.render(()=> '<!doctype html><html><head></head><body>Fail<script>throw new Error("synthetic preview fault")</script></body></html>');await modify(page);await expect(summary(page)).toContainText('预览加载或运行失败');await expect(summary(page)).not.toContainText('可试用，未采用');
 await page.getByRole('button',{name:'放弃本轮修改',exact:true}).click();store.restrict({status:'blocked',reasons:['synthetic blocker'],dataMode:'trial',adoption:'blocked',review:'issues'});
 await page.getByLabel('追加修改需求').fill('blocked');await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(summary(page)).toContainText('执行阻断');await expect(page.locator('iframe')).toHaveCount(0);await expect(summary(page)).not.toContainText('可试用');
});

test('candidate ready stays unadopted; accessible stage updates exclude ticking time',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await modify(page);await expect(summary(page)).toContainText('可试用，未采用');
 const live=summary(page).getByRole('status');await expect(live).not.toContainText('秒');expect(await summary(page).locator('[aria-live="off"]').count()).toBe(1);
 await page.getByLabel('追加修改需求').fill('next draft');const iframe=await page.locator('iframe').elementHandle();await add(page);await expect(frame(page).locator('#count')).toHaveText('1');
 await page.getByText('模型调用与用量',{exact:false}).last().click();await expect(page.getByLabel('追加修改需求')).toHaveValue('next draft');expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);await expect(frame(page).locator('#count')).toHaveText('1');expect(store.calls()).toBe(2);expect([...store.rows.values()][0].cloud.state).toBe(null);
});


test('trial preparation names the data wait, then preview load remains pending until an actual load event',async({page,context})=>{
 const store=await fixture();await store.connect(context);
 let release=()=>{};const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/projects/*/data*',async route=>{if(route.request().method()==='GET')await gate;await route.fallback();});
 await generate(page);await expect(ready(page)).toBeVisible();
 await page.getByLabel('追加修改需求').fill('prepare a copy');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(summary(page)).toContainText('正在准备试用副本');expect(store.calls()).toBe(1);await expect(summary(page)).not.toContainText('等待模型响应');release();
 await expect(summary(page)).toContainText('可试用，未采用');expect(store.calls()).toBe(2);
});

test('delayed iframe load is not ready; 15 second load failure stays explicit without model retry',async({page,context})=>{
 const store=await fixture();await store.connect(context);
 // Browser lifecycle fault seam, no component setters or fabricated ready state.
 await page.addInitScript(()=>{
  const add=EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener=function(type,listener,options){
   if(this instanceof HTMLIFrameElement && type==='load')return;
   return add.call(this,type,listener,options);
  };
 });
 await page.clock.install();await generate(page);await expect(ready(page)).toBeVisible();
 await expect(summary(page)).toContainText('准备预览 · 正在加载隔离预览');await expect(summary(page)).not.toContainText('可试用');
 const time=await summary(page).locator('.generation-progress-heading').textContent();await page.clock.runFor(15001);
 await expect(summary(page)).toContainText('预览加载或运行失败');await expect(summary(page).locator('.generation-progress-heading')).toHaveText(time!);expect(store.calls()).toBe(1);
});


test('stop during trial preparation ends immediately and ignores the late shared read',async({page,context})=>{
 const store=await fixture();await store.connect(context);
 let release=()=>{};const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/api/projects/*/data*',async route=>{if(route.request().method()==='GET')await gate;await route.fallback();});
 await generate(page);await expect(ready(page)).toBeVisible();const iframe=await page.locator('iframe').elementHandle();
 await page.getByLabel('追加修改需求').fill('stop before model');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(summary(page)).toContainText('正在准备试用副本');await page.getByRole('button',{name:'停止生成',exact:true}).click();
 await expect(summary(page)).toContainText('任务已停止');await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeEnabled();
 expect(store.calls()).toBe(1);release();await expect(frame(page).getByRole('button',{name:'增加',exact:true})).toBeEnabled();
 await expect(summary(page)).toContainText('任务已停止');await expect(page.getByLabel('追加修改需求')).toHaveValue('stop before model');expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);expect(store.calls()).toBe(1);
});
