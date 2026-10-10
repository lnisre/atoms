import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { syntheticArtifact } from "../helpers/artifact";
import { signProof } from "../../src/lib/cloud-projects/artifacts";
import type { Artifact } from "../../src/lib/cloud-projects/artifact-contract";
import type { CloudProject, CommitReceipt } from "../../src/lib/cloud-projects/contract";
const html=(revision:number)=>`<!doctype html><html><head></head><body><h1>Counter ${revision}</h1><button id="add" disabled>增加</button><output id="count"></output><p id="status"></p><script>
let state;const button=document.querySelector('#add'),out=document.querySelector('#count'),status=document.querySelector('#status');
atoms.loadState().then(value=>{state=value??{count:0};out.textContent=state.count;button.disabled=false}).catch(()=>status.textContent='读取失败');
button.onclick=async()=>{state.count++;out.textContent=state.count;status.textContent='保存中';try{await atoms.saveState(state);status.textContent='更新完成'}catch{status.textContent='保存失败'}};
</script></body></html>`;
async function fixture() {
 process.env.ATOMS_ARTIFACT_SECRET='b'.repeat(64);
 const rows=new Map<string,{owner:string;cloud:CloudProject}>(),operations=new Map<string,CommitReceipt>();
 let calls=0, lost=false, logsFail=false, generationFail=false, policy:Artifact['policy']|undefined;
 let generationGate:Promise<void>|undefined,releaseGeneration=()=>{},saveGate:Promise<void>|undefined,releaseSave=()=>{};
 const bodies:unknown[]=[];
 async function connect(context:BrowserContext,owner='owner-a',signed=true) {
  let account=owner,authenticated=signed;
  await context.route('**/api/auth/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/code'))return route.fulfill({json:{sent:true,retryAfter:60}});
   if(path.endsWith('/verify'))authenticated=true;
   if(path.endsWith('/logout'))authenticated=false;
   return route.fulfill({status:authenticated||path.endsWith('/logout')?200:401,json:authenticated?{account:{id:account,email:account+'@example.invalid'}}:{error:'登录已失效'}});
  });
  await context.route('**/api/team',route=>route.fulfill({json:{ok:true}}));
  await context.route('**/api/generate',async route=>{
   const body=route.request().postDataJSON(),taskId=route.request().headers()['x-atoms-task-id'];
   calls++;if(generationFail){generationFail=false;return route.fulfill({status:503,json:{error:'synthetic generation unavailable'}});}
   const previous=body.parent?JSON.parse(body.parent.payload) as Artifact:undefined;
   const official=rows.get(body.projectId)?.cloud.project;
   const base=previous?.result.html??official?.draftResult?.html??official?.result.html;
   const f=syntheticArtifact(account,body.projectId,taskId,html(calls),base,body.expected,previous?.generations);
   if(previous)f.artifact.baseHash=previous.baseHash;
   if(policy)f.artifact.policy=policy;
   // Explicitly synthetic BFF/transport proof; production qualification tested
   // separately through real server functions and PG. No model/email calls.
   const proof=signProof(f.artifact);
   const wire=[{type:'session',protocol:'atoms-team/3',taskId,projectId:body.projectId,token:'synthetic',deadline:Date.now()+240000},{type:'result',protocol:'atoms-team/3',taskId,team:f.team,result:f.artifact.result,assistantReply:'Synthetic assistant explanation',proof}].map(m=>JSON.stringify(m)).join('\n')+'\n';
   if(generationGate)await generationGate;
   await route.fulfill({contentType:'application/x-ndjson',body:wire}).catch(()=>{});
  });
  await context.route('**/api/projects**',async route=>{
   const req=route.request(),url=new URL(req.url()),body=req.method()==='GET'?undefined:req.postDataJSON();
   if(!authenticated||req.headers()['x-atoms-account']!==account)return route.fulfill({status:401,json:{code:'unauthenticated',error:'登录已失效，请重新登录原账号。'}});
   if(url.pathname==='/api/projects')return route.fulfill({json:[...rows.values()].filter(r=>r.owner===account).map(r=>r.cloud.project)});
   if(url.pathname==='/api/projects/events')return route.fulfill({status:logsFail?503:200,json:logsFail?{error:'日志失败'}:{projectId:JSON.parse(body.proof.payload).projectId,version:{code:1,data:1},updatedAt:new Date().toISOString()}});
   if(url.pathname==='/api/projects/artifact'){
    bodies.push(body);if(saveGate)await saveGate;
    const a=JSON.parse(body.proof.payload) as Artifact,old=rows.get(a.projectId),key=account+body.operationId;
    if(a.ownerId!==account)return route.fulfill({status:403,json:{error:'foreign artifact'}});
    let receipt=operations.get(key);
    if(!receipt){
     if(a.expected&&JSON.stringify(a.expected)!==JSON.stringify(old?.cloud.version))return route.fulfill({status:409,json:{code:'conflict',error:'云端已有更新，候选已保留。'}});
     const project={...(old?.cloud.project??{id:a.projectId,title:a.requirement,requirement:a.requirement,initialGeneration:a.initialGeneration}),updatedAt:new Date().toISOString(),result:a.result,previewPolicy:{...a.policy,...(a.expected?{dataMode:'formal' as const}:{})},modificationRecords:[...(old?.cloud.project.modificationRecords??[]),...(a.expected?[{id:body.operationId,adoptedAt:new Date().toISOString(),requests:a.generations.map(g=>g.requirement),summary:'采用候选',generations:a.generations}]:[])]};
     const cloud:CloudProject={project,version:{code:(old?.cloud.version.code??0)+1,data:old?.cloud.version.data??1},state:old?.cloud.state??null,hasData:old?.cloud.hasData??false};
     rows.set(a.projectId,{owner:account,cloud});receipt={projectId:a.projectId,version:{...cloud.version},updatedAt:project.updatedAt};operations.set(key,receipt);
    }
    if(lost){lost=false;return route.abort('failed');}
    return route.fulfill({json:{...receipt,logProof:signProof({projectId:a.projectId})}});
   }
   if(url.pathname==='/api/projects/activate'){
    const row=rows.get(body.projectId)!;if(row.cloud.project.previewPolicy?.adoption!=='allowed')return route.fulfill({status:403,json:{error:'restricted'}});
    row.cloud.version.code++;row.cloud.project.previewPolicy.dataMode='formal';
    return route.fulfill({json:{projectId:body.projectId,version:row.cloud.version,updatedAt:new Date().toISOString()}});
   }
   const id=url.pathname.split('/')[3],row=rows.get(id);
   if(!row||row.owner!==account)return route.fulfill({status:404,json:{error:'项目不可见'}});
   if(url.pathname.endsWith('/data')){
    if(req.method()==='GET')return route.fulfill({json:{state:row.cloud.state,hasData:row.cloud.hasData,version:row.cloud.version}});
    if(JSON.stringify(body.expected)!==JSON.stringify(row.cloud.version))return route.fulfill({status:409,json:{code:'conflict',error:'云端已有更新，已拒绝覆盖。'}});
    row.cloud.state=body.state;row.cloud.hasData=true;row.cloud.version.data++;
    return route.fulfill({json:{projectId:id,version:row.cloud.version,updatedAt:new Date().toISOString()}});
   }
   return route.fulfill({json:row.cloud});
  });
  return {expire:()=>{authenticated=false;},switchTo:(id:string)=>{account=id;authenticated=false;}};
 }
 return {rows,connect,bodies,failGeneration:()=>{generationFail=true;},calls:()=>calls,loseSave:()=>{lost=true;},failLogs:(b:boolean)=>{logsFail=b;},restrict:(value:Artifact['policy'])=>{policy=value;},
  holdGeneration:()=>{generationGate=new Promise<void>(r=>{releaseGeneration=r;});},releaseGeneration:()=>{releaseGeneration();generationGate=undefined;},
  holdSave:()=>{saveGate=new Promise<void>(r=>{releaseSave=r;});},releaseSave:()=>{releaseSave();saveGate=undefined;}};
}
async function login(page:Page,owner='owner-a') {
 const email=page.getByLabel('邮箱地址',{exact:true});if(await email.getAttribute('readonly')===null)await email.fill(owner+'@example.invalid');else await expect(email).toHaveValue(owner+'@example.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('6 位验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并登录'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
}
async function generate(page:Page){await page.goto('/');await page.getByLabel('你想做什么？').fill('Synthetic counter');await page.getByRole('button',{name:'开始生成',exact:true}).click();}
const frame=(p:Page)=>p.frameLocator('iframe[title="生成的应用"]');
const ready=(p:Page)=>p.getByText('云端已保存代码',{exact:false});
async function modify(p:Page){await p.getByLabel('追加修改需求').fill('change');await p.getByRole('button',{name:'生成候选',exact:true}).click();await expect(p.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();}

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
 // Keyboard avoids the known opaque-frame initial pointer race; other cases retain pointer coverage.
 await frame(page).getByRole('button',{name:'增加',exact:true}).press('Enter');await expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
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
