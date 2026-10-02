import { fulfillGeneration } from "./team-fixture";
import { expect, test, type Page } from "@playwright/test";

const html = (round: number) => `<!DOCTYPE html><html><head></head><body><h1>版本${round}</h1><button disabled>增加</button><output>0</output><script>
let n=0;const b=document.querySelector('button'),o=document.querySelector('output');
atoms.loadState().then(s=>{n=s??0;o.textContent=n;b.disabled=false});b.onclick=()=>{o.textContent=++n;atoms.saveState(n)};
</script></body></html>`;
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result); });
    const read = (name: string) => new Promise<unknown[]>(resolve=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result)});
    const projects = await read('projects'), data = await read('applicationData'); db.close();
    const snapshot = JSON.parse(JSON.stringify({projects,data}));
    const activeId = new URLSearchParams(location.search).get('project');
    snapshot.projects.sort((a: { id: string }, b: { id: string }) => Number(b.id === activeId) - Number(a.id === activeId));
    return snapshot;
  });
}
async function setup(page: Page) {
  let calls=0;
  const requests: {baseHtml?:string;context?:string[];taskId:string}[]=[];
  const control={failure:'',missing:false};
  await page.route('**/api/generate', route=>{
    const body=route.request().postDataJSON(), taskId=route.request().headers()['x-atoms-task-id'];
    requests.push({...body,taskId}); const round=calls++;
    const event={taskId,source:'server',sequence:1,stepId:'model',label:'调用模型',status:'started',at:new Date().toISOString(),detail:'受控协议响应'};
    const end= control.failure==='mismatch' ? {type:'result',taskId:'obsolete-task',result:{html:html(round),model:'fixture',durationMs:1,generatedAt:String(round)},assistantReply:'旧任务'}
      : control.failure==='model' ? {type:'error',taskId,error:'受控模型失败'}
      : {type:'result',taskId,result:{html:control.failure==='html'?'<!DOCTYPE html><html>截断':html(round),model:'fixture',durationMs:1,generatedAt:String(round)},assistantReply:control.missing?null:`真实协议测试说明${round}`};
    return fulfillGeneration(route, {contentType:'application/x-ndjson',body:[{type:'step',event},{type:'step',event:{...event,sequence:2,status:control.failure==='model'?'failed':'completed'}},end].map(x=>JSON.stringify(x)).join('\n')+'\n'});
  });
  await page.goto('/'); await page.getByLabel('你想做什么？').fill('多轮记录验收');
  await page.getByRole('button',{name:'开始生成'}).click();
  await expect(page.frameLocator('iframe').getByRole('button',{name:'增加'})).toBeEnabled();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');
  await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
  await expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0);
  return {control,requests,calls:()=>calls};
}
async function modify(page:Page,text:string) {
  await page.getByLabel('追加修改需求').fill(text);await page.getByRole('button',{name:'生成候选',exact:true}).click();
}

test('多轮回复和执行记录随最新代码采用，恢复零调用，首次消息和正式数据不变',async({page,context})=>{
  const {requests,calls}=await setup(page); const before=await snapshot(page);
  await modify(page,'增加标题');await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本1'})).toBeVisible();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');
  await expect(page.locator('.data-status')).toContainText('试用数据已更新');
  await expect(page.getByRole('region',{name:'本轮修改记录'}).getByText('更新试用数据',{exact:true})).toBeVisible();
  await modify(page,'保留标题调整颜色');await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本2'})).toBeVisible();
  expect(requests[1].baseHtml).toBe(html(0));expect(requests[2].baseHtml).toBe(html(1));expect(requests[2].context).toEqual(['增加标题']);
  expect(new Set(requests.map(x=>x.taskId)).size).toBe(3);
  expect(await snapshot(page)).toEqual(before);
  await page.getByLabel('追加修改需求').fill('尚未提交的输入');
  await page.getByRole('region',{name:'本轮修改记录'}).last().getByText('载入隔离预览',{exact:true}).click();
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  await expect(page.getByLabel('追加修改需求')).toHaveValue('尚未提交的输入');
  const oldChannel=await page.locator('iframe').evaluate(el=>JSON.parse((el as HTMLIFrameElement).srcdoc.match(/const \{channel,origin\}=(.*?);/)![1]).channel);
  await page.getByRole('button',{name:'采用修改',exact:true}).click();
  await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
  await page.frameLocator('iframe').locator('body').evaluate((_el,channel)=>parent.postMessage({type:'atoms:state',channel,id:999,method:'save',state:999},'*'),oldChannel);
  const saved=await snapshot(page);expect(saved.data).toEqual(before.data);
  expect(saved.projects[0].initialGeneration).toEqual(before.projects[0].initialGeneration);
  const record=saved.projects[0].modificationRecords[0];expect(record.codeTaskId).toBe(requests[2].taskId);
  expect(record.generations.map((x:{assistantReply:string})=>x.assistantReply)).toEqual(['真实协议测试说明1','真实协议测试说明2']);
  expect(record.generations.every((x:{events:Array<{taskId:string}>;taskId:string;projectId:string;html?:string})=>x.events.every(e=>e.taskId===x.taskId)&&x.projectId===saved.projects[0].id&&!x.html)).toBe(true);
  expect(record.generations[1].events.some((x:{stepId:string;status:string})=>x.stepId==='adoption'&&x.status==='completed')).toBe(true);
  const url=page.url();await page.reload();await expect(page.getByRole('region',{name:'已保存修改记录',exact:true}).filter({has:page.locator('.assistant-reply')})).toHaveCount(2);
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');expect(calls()).toBe(3);
  await modify(page,'重开后继续修改');await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本3'})).toBeVisible();
  expect(requests[3].baseHtml).toBe(html(2));expect(requests[3].context).toEqual(['增加标题', '保留标题调整颜色']);
  await page.close();const reopened=await context.newPage();let extra=0;reopened.on('request',r=>{if(r.url().endsWith('/api/generate'))extra++});await reopened.goto(url);
  await expect(reopened.locator('.assistant-reply')).toHaveText(['真实协议测试说明0','真实协议测试说明1','真实协议测试说明2']);expect(extra).toBe(0);
});

test('失败、无效HTML与旧任务事件保留有效候选；放弃和刷新丢弃会话消息',async({page})=>{
  const {control,calls}=await setup(page);const before=await snapshot(page);
  await modify(page,'有效候选');await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本1'})).toBeVisible();
  for(const failure of ['model','html','mismatch']){
    control.failure=failure;await modify(page,'失败尝试 '+failure);
    await expect(page.getByRole('region',{name:'对话修改'}).getByRole('alert')).toBeVisible();
    await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本1'})).toBeVisible();
  }
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button',{name:'放弃本轮修改'}).click();await expect(page.locator('.assistant-reply')).toHaveCount(1);
  control.failure='';await modify(page,'刷新丢弃');await expect(page.getByText('真实协议测试说明5',{exact:true})).toBeVisible();
  await page.reload();await expect(page.locator('.assistant-reply')).toHaveText(['真实协议测试说明0']);
  await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本0'})).toBeVisible();expect(calls()).toBe(6);
});

test('采用事务失败不保存消息或代码，保留候选可重试，缺正文也可采用',async({page,context})=>{
  const {control,calls}=await setup(page);const before=await snapshot(page);control.missing=true;
  await modify(page,'缺说明候选');await expect(page.getByRole('region',{name:'本轮修改记录'}).getByText('本次未取得助手说明',{exact:true})).toBeVisible();
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){IDBObjectStore.prototype.put=put;const r=put.apply(this,args);r.addEventListener('success',()=>this.transaction.abort());return r}});
  await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByText(/采用保存失败。/)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  const check=await context.newPage();await check.goto(page.url());await expect(check.frameLocator('iframe').getByRole('heading',{name:'版本0'})).toBeVisible();await expect(check.locator('.assistant-reply')).toHaveCount(1);await check.close();
  await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
  await page.reload();await expect(page.locator('.assistant-reply')).toHaveText(['真实协议测试说明0','本次未取得助手说明']);expect(calls()).toBe(2);
});

test('修改等待期间展示真实事件，原候选可用，错误终态结束等待',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{
    const original=window.fetch;window.fetch=async(...args)=>{
      if(args[0]!=='/api/generate')return original(...args);
      const taskId=new Headers(args[1]?.headers).get('X-Atoms-Task-Id');const encoder=new TextEncoder();
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(encoder.encode(JSON.stringify({type:'session',protocol:'atoms-team/3',taskId,projectId:JSON.parse(String(args[1]?.body)).projectId,token:'fixture'})+'\n'));
        controller.enqueue(encoder.encode(JSON.stringify({type:'step',event:{taskId,source:'server',sequence:1,stepId:'model',label:'调用模型',status:'started',at:new Date().toISOString(),detail:'受控等待'}})+'\n'));
        Object.assign(window,{finishModification:()=>{controller.enqueue(encoder.encode(JSON.stringify({type:'error',taskId,error:'受控连接终态'})+'\n'));controller.close()}});
      }}),{headers:{'Content-Type':'application/x-ndjson'}});
    };
  });
  await modify(page,'实时等待');const record=page.getByRole('region',{name:'本轮修改记录'});
  await expect(record.getByText('调用模型',{exact:true})).toBeVisible();await expect(record.getByText('等待模型完整说明…')).toBeVisible();
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
  await page.evaluate(()=>(window as unknown as {finishModification:()=>void}).finishModification());
  await expect(page.getByRole('region',{name:'对话修改'}).getByRole('alert')).toContainText('受控连接终态');
  await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeEnabled();
});


test('真实HTTP修改入口验证失败返回任务终态，不触发模型',async({request})=>{
  const response=await request.post('/api/generate',{headers:{Accept:'application/x-ndjson','X-Atoms-Task-Id':'http-modification'},data:{requirement:'原应用',modification:'修改',baseHtml:'',context:[]}});
  expect(response.status()).toBe(200);const events=(await response.text()).trim().split('\n').map(x=>JSON.parse(x));
  expect(events.at(-1).type).toBe('error');expect(events.at(-1).taskId).toBe('http-modification');expect(events.at(-2).event.status).toBe('failed');
});

test('采用后的日志追加失败如实提示，代码和消息已提交，重开不补造成功步骤',async({page})=>{
  await setup(page);await modify(page,'日志故障候选');await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本1'})).toBeVisible();
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;let count=0;IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);if(this.name==='projects'&&++count===2){IDBObjectStore.prototype.put=put;r.addEventListener('success',()=>this.transaction.abort())}return r}});
  await page.getByRole('button',{name:'采用修改',exact:true}).click();
  await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.getByText(/执行记录保存失败，最新步骤可能无法恢复/)).toBeVisible();
  await page.reload();await expect(page.frameLocator('iframe').getByRole('heading',{name:'版本1'})).toBeVisible();
  const record=page.getByRole('region',{name:'已保存修改记录'});await expect(record.locator('.assistant-reply')).toHaveText('真实协议测试说明1');
  await expect(record.getByText('未记录结束状态',{exact:true})).toBeVisible();
});
