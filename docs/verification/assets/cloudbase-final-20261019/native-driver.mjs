// Explicit final verification: real gateway, Next, Python and pinned MetaGPT;
// existing synthetic Auth/PG and model transport, with real wall-clock waits.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { basename } from 'node:path';
const root='/Users/gaowenlong/.codex/worktrees/cloudbase-migration-90/atoms';
const baseRun='/private/tmp/atoms-cloudbase-final-verify.rUqsZ1';
const run=process.argv[2]||baseRun;
const {chromium}=createRequire(root+'/package.json')('@playwright/test');
const instance=JSON.parse(readFileSync(process.argv[3]||baseRun+'/instance.json','utf8'));
assert.equal(instance.origin,'http://127.0.0.1:32315');
assert.equal(instance.mode,'offline-native-team');
const started=Date.now(), records=[], samples=[], errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const contexts=[];
let sampling, progress;
function sample(){
  const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{
    const [,pid,parent,rss,command]=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)||[];
    return {pid:Number(pid),parent:Number(parent),rssKiB:Number(rss),command:basename(command||'')};
  });
  const owned=new Set([instance.pid]);
  for(let changed=true;changed;){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true}}
  const processes=rows.filter(row=>owned.has(row.pid));
  const result={at:Date.now(),rssKiB:processes.reduce((sum,row)=>sum+row.rssKiB,0),processes};
  samples.push(result);return result;
}
async function until(check, timeout=15000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await delay(250)}
  throw Error('Required public observation did not arrive in time');
}
async function session(name){
  const context=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(context);
  const page=await context.newPage();
  const record={name,modelCalls:0,engineerCalls:0,artifacts:0,terminalOutcome:null,closed:false,heartbeats:0,acks:0};records.push(record);
  page.on('pageerror',error=>errors.push({name,message:error.message}));
  page.on('websocket',socket=>{
    if(!socket.url().endsWith('/api/team/socket'))return;
    record.socketAt=Date.now();
    socket.on('framesent',frame=>{const m=JSON.parse(String(frame.payload));if(m.action==='heartbeat')record.heartbeats++});
    socket.on('framereceived',frame=>{
      const m=JSON.parse(String(frame.payload));
      if(m.type==='session'){record.deadline=m.deadline;record.sessionAt=Date.now()}
      if(m.type==='control-ack'&&m.ok)record.acks++;
      if(m.type==='call'&&m.call.status==='started'){record.modelCalls++;if(m.call.actor==='Engineer')record.engineerCalls++}
      if(m.type==='artifact')record.artifacts++;
      if(m.type==='result'||m.type==='error'){record.terminalOutcome=m.outcome??m.team?.outcome??(m.type==='result'?'passed':'failed');record.terminalAt=Date.now()}
      if(m.type==='socket-error')record.socketError=m.error;
    });
    socket.on('close',()=>{record.closed=true;record.closedAt=Date.now()});
  });
  await page.goto(instance.origin);
  await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();
  await page.getByLabel('邮箱地址',{exact:true}).fill('synthetic@example.invalid');
  await page.getByRole('button',{name:'发送验证码',exact:true}).click();
  await page.getByLabel('6 位验证码',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'验证并登录'}).click();
  await page.getByText('synthetic@example.invalid',{exact:true}).waitFor();
  return {page,record};
}
let result={status:'running',mode:'offline-native-team-real-wall-clock',actualProviderCalls:0,sourceCommit:instance.sourceCommit};
try{
  sampling=setInterval(()=>sample(),10000);
  progress=setInterval(()=>{
    const value={elapsedMs:Date.now()-started,records};
    writeFileSync(run+'/native-long-progress.json',JSON.stringify(value,null,2)+'\n');
    console.log(JSON.stringify(value));
  },30000);
  const good=await session('420-second-success');
  const expired=await session('480-second-timeout');
  await good.page.getByLabel('你想做什么？').fill('CLOUDBASE_LONG_SUCCESS 受控计数器，增加并保存计数');
  await good.page.getByRole('button',{name:'开始生成',exact:true}).click();
  await expired.page.getByLabel('你想做什么？').fill('CLOUDBASE_LONG_TIMEOUT 受控计数器，验证执行上限');
  await expired.page.getByRole('button',{name:'开始生成',exact:true}).click();
  await until(()=>good.record.engineerCalls===1&&expired.record.engineerCalls===1,60000);
  const running=sample();
  assert.equal(running.processes.filter(row=>/python/i.test(row.command)).length,2);
  const third=await session('third-task-rejected');
  await third.page.getByLabel('你想做什么？').fill('受控第三个任务必须显示繁忙');
  await third.page.getByRole('button',{name:'开始生成',exact:true}).click();
  await third.page.getByRole('alert').filter({hasText:'生成执行器繁忙'}).waitFor({timeout:15000});
  assert.equal(third.record.modelCalls,0);
  await third.page.screenshot({path:run+'/native-third-task.png'});
  await until(()=>{
    if(good.record.socketError||expired.record.socketError)throw Error('Unexpected transport interruption before a terminal task result');
    return Boolean(good.record.terminalOutcome)&&Boolean(expired.record.terminalOutcome);
  },510000);
  await good.page.getByText('云端已保存代码',{exact:false}).waitFor({timeout:15000});
  assert.equal(good.record.terminalOutcome,'passed');
  assert.ok(good.record.terminalAt-good.record.socketAt>=420000);
  assert.ok(good.record.terminalAt<good.record.deadline);
  const add=good.page.frameLocator('iframe').getByRole('button',{name:'增加',exact:true});
  await add.hover();await until(()=>add.evaluate(el=>el.matches(':hover')));
  await add.click();
  await until(()=>good.page.frameLocator('iframe').locator('output').textContent().then(value=>value==='1'));
  await good.page.getByText('应用数据已保存到云端',{exact:true}).waitFor();
  await good.page.screenshot({path:run+'/native-long-success.png'});
  assert.equal(expired.record.terminalOutcome,'limit');
  assert.ok(Math.abs(expired.record.terminalAt-expired.record.deadline)<=5000);
  assert.equal(expired.record.artifacts,0);
  await expired.page.screenshot({path:run+'/native-timeout.png'});
  await expired.page.getByRole('region',{name:'生成进度',exact:true}).getByText('任务已达到执行上限',{exact:true}).waitFor();
  await until(()=>good.record.closed&&expired.record.closed);
  await delay(1500);
  const stopped=sample();
  assert.equal(stopped.processes.filter(row=>/python/i.test(row.command)).length,0);
  assert.deepEqual(errors,[]);
  result={...result,status:'passed',records,samples,errors,durationMs:Date.now()-started,
    peakOwnedRssKiB:Math.max(...samples.map(row=>row.rssKiB)),
    limits:'Darwin local runtime with synthetic identity/storage/model. Does not prove Linux CloudBase resources or real provider behaviour.'};
}catch(error){result={...result,status:'failed',error:error.message,records,samples,errors,durationMs:Date.now()-started};throw error}
finally{
  clearInterval(sampling);
  clearInterval(progress);
  for(const context of contexts)await context.close();
  await browser.close();
  await delay(1500);
  result.cleanup={browserClosed:true,remainingOwnedPython:sample().processes.filter(row=>/python/i.test(row.command)).length};
  writeFileSync(run+'/native-long-summary.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,durationMs:result.durationMs,records:result.records,peakOwnedRssKiB:result.peakOwnedRssKiB,error:result.error}));
}
