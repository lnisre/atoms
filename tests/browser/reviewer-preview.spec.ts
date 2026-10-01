import {test,expect,type Route} from '@playwright/test';
import {createHash} from 'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
type Mode='minor'|'major'|'clean'|'data'|'unknown'|'fatal'|'resolved';
async function respond(route:Route,mode:Mode) {
  const input=route.request().postDataJSON(), taskId=route.request().headers()['x-atoms-task-id'];
  const makeHtml=(i:number)=>`<!doctype html><html><head></head><body><h1>审查预览夹具</h1><button disabled id="add">增加</button><output>0</output><script>${mode==='fatal'?'while(true){}':''}
let state={count:0};const b=document.querySelector('#add'),o=document.querySelector('output');
window.atoms.loadState().then(s=>{state=s??{count:0};o.textContent=state.count;b.disabled=false});
b.onclick=async()=>{state.count+=2;await window.atoms.saveState(${mode==='data'?'{count:state.count}':'state'});o.textContent=state.count};
</script></body></html>${' '.repeat(i)}`;
  const deliver=(role:string,v:unknown)=>({role,content:JSON.stringify(v)});
  const assign=(to:string)=>deliver('Mike',{command:'assign',to});
  const deliveries=[assign('Requirements'),deliver('Requirements',{requirements:[{id:'increment'}]})];
  let review,html='';
  const rounds=mode==='major'?3:1;
  for(let i=1;i<=rounds;i++) {
    html=makeHtml(i);
    deliveries.push(assign('Engineer'),deliver('Engineer',{iteration:i,codeHash:hash(html),assistantReply:'离线夹具'}));
    if(mode==='unknown')break;
    const hasIssues=['minor','major','data'].includes(mode);
    review={kind:'code-review',schemaVersion:1,taskId,codeHash:hash(html),approved:!hasIssues,summary:'离线静态审查，未运行浏览器',issues:hasIssues?[{id:mode==='data'?'preserve-fields':'increment',severity:mode==='minor'?'minor':'major',category:mode==='data'?'data-loss':'functionality',codeQuote:mode==='data'?'saveState({count:state.count})':'state.count+=2',trigger:'点击增加',consequence:mode==='data'?'未知字段丢失':'计数增加两次'}]:[],resolutions:mode==='resolved'?(input.baseDataIssues??[]).map((i:{id:string})=>({id:i.id,codeQuote:'saveState(state)',explanation:'完整保存所有字段'})):[]};
    deliveries.push(assign('Reviewer'),deliver('Reviewer',review));
  }
  if(mode!=='unknown')deliveries.push(deliver('Mike',{command:'finish'}));
  const outcome=mode==='unknown'?'failed':review?.issues.length?'issues':'passed';
  const team={protocol:'atoms-team/3',taskId,projectId:input.projectId,baseCodeHash:input.baseHtml?hash(input.baseHtml):undefined,baseDataIssues:input.baseHtml?input.baseDataIssues??[]:undefined,codeHash:hash(html),review,deliveries,outcome,calls:deliveries.map((d,i)=>({call:i+1,actor:d.role,status:'completed',requestedModel:'OFFLINE FIXTURE'}))};
  const messages=[{type:'session',protocol:team.protocol,taskId,projectId:input.projectId,token:'offline'}, {type:mode==='unknown'?'error':'result',protocol:team.protocol,taskId,team,outcome,error:mode==='unknown'?'Reviewer 格式无效':undefined,result:{html,model:'OFFLINE FIXTURE',durationMs:1,generatedAt:crypto.randomUUID()},assistantReply:'这是离线夹具，不是真实模型结果。'}];
  await route.fulfill({contentType:'application/x-ndjson',body:messages.map(m=>JSON.stringify(m)).join('\n')+'\n'});
}
async function begin(page:import('@playwright/test').Page) {await page.goto('/');await page.getByLabel('你想做什么？').fill('受控审查预览');await page.getByRole('button',{name:'开始生成',exact:true}).click();await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();}
for(const mode of ['minor','major'] as const) test(`${mode}: findings survive preview, automatic save and reopen; two repairs stop after three artifacts`,async({page})=>{
  let calls=0;await page.route('**/api/generate',r=>{calls++;return respond(r,mode)});
  await begin(page);await expect(page.locator('iframe')).toBeVisible();await expect(page.getByLabel('追加修改需求')).toBeEnabled();
  await expect(page.getByText(/代码审查：有待修复问题/)).toBeVisible();
  await expect(page.getByText(/实现工程师 · 交付/)).toHaveCount(mode==='major'?3:1);
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).click();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();await page.reload();
  await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');await expect(page.getByText(/代码审查：有待修复问题/)).toBeVisible();expect(calls).toBe(1);
});
test('unavailable review keeps a restorable draft, truthful failure, and explicit first use without trial data',async({page})=>{
  await page.route('**/api/generate',r=>respond(r,'unknown'));await begin(page);
  await expect(page.getByText('执行失败',{exact:true})).toBeVisible();await expect(page.getByText(/审查未完成，代码已保留/)).toBeVisible();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).click();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  const stored=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('atoms-projects');r.onsuccess=()=>resolve(r.result)});const p=await new Promise<Record<string,{html:string}>>(resolve=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result[0])});db.close();return p;});
  expect(stored.result.html).not.toContain('saveState');expect(stored.draftResult.html).toContain('saveState');
  await page.reload();await expect(page.getByRole('button',{name:'使用此版本'})).toBeEnabled();await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');
  await page.getByRole('button',{name:'使用此版本'}).click();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');
  await page.reload();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.getByText('执行失败',{exact:true})).toBeVisible();
});
test('data-risk candidate is visible but cannot be adopted, including after unavailable rereview; actual resolution unlocks adoption',async({page})=>{
  let mode:Mode='clean';await page.route('**/api/generate',r=>respond(r,mode));await begin(page);
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).click();await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
  const change=async(m:Mode)=>{mode=m;await page.getByLabel('追加修改需求').fill(m);await page.getByRole('button',{name:'生成候选',exact:true}).click();};
  await change('data');await expect(page.getByText('第 1 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();
  await page.frameLocator('iframe').getByRole('button',{name:'增加'}).click();await expect(page.frameLocator('iframe').locator('output')).toHaveText('4');
  await change('unknown');await expect(page.getByText('第 2 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();
  await change('resolved');await expect(page.getByText('第 3 轮候选 · 等待采用')).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');
  await page.reload();await expect(page.frameLocator('iframe').locator('output')).toHaveText('2');await expect(page.getByText('执行失败',{exact:true})).toBeVisible();
});
test('platform execution blocker does not mount even with model approval; code can be restored and modified',async({page})=>{
  await page.route('**/api/generate',r=>respond(r,'fatal'));await begin(page);await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'无条件空循环'})).toBeVisible();await expect(page.getByLabel('追加修改需求')).toBeEnabled();
  await page.reload();await expect(page.locator('iframe')).toHaveCount(0);await expect(page.getByRole('alert').filter({hasText:'无条件空循环'})).toBeVisible();
});
