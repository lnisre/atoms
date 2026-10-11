import { expect, type BrowserContext, type Page } from "@playwright/test";
import { syntheticArtifact } from "./artifact";
import { signProof } from "../../src/lib/cloud-projects/artifacts";
import type { Artifact } from "../../src/lib/cloud-projects/artifact-contract";
import type { CloudProject, CommitReceipt } from "../../src/lib/cloud-projects/contract";
// Explicit in-memory Auth/BFF/provider seam. Real DOM and iframe; no email/model/PG claims.
const html=(revision:number)=>`<!doctype html><html><head></head><body><h1>Counter ${revision}</h1><button id="add" disabled>增加</button><output id="count"></output><p id="status"></p><script>
let state;const button=document.querySelector('#add'),out=document.querySelector('#count'),status=document.querySelector('#status');
atoms.loadState().then(value=>{state=value??{count:0};out.textContent=state.count;button.disabled=false}).catch(()=>status.textContent='读取失败');
button.onclick=async()=>{state.count++;out.textContent=state.count;status.textContent='保存中';try{await atoms.saveState(state);status.textContent='更新完成'}catch{status.textContent='保存失败'}};
</script></body></html>`;
export async function fixture() {
 process.env.ATOMS_ARTIFACT_SECRET='b'.repeat(64);
 const rows=new Map<string,{owner:string;cloud:CloudProject}>(),operations=new Map<string,CommitReceipt>();
 let render=html, includeProof=true;
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
   const f=syntheticArtifact(account,body.projectId,taskId,render(calls),base,body.expected,previous?.generations);
   if(previous)f.artifact.baseHash=previous.baseHash;
   if(policy)f.artifact.policy=policy;
   // Explicitly synthetic BFF/transport proof; production qualification tested
   // separately through real server functions and PG. No model/email calls.
   const proof=signProof(f.artifact);
   const wire=[{type:'session',protocol:'atoms-team/3',taskId,projectId:body.projectId,token:'synthetic',deadline:Date.now()+240000},{type:'result',protocol:'atoms-team/3',taskId,team:f.team,result:f.artifact.result,assistantReply:'Synthetic assistant explanation',...(includeProof?{proof}:{})}].map(m=>JSON.stringify(m)).join('\n')+'\n';
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
     if(project.previewPolicy.dataMode==='trial'){
      Object.assign(project,{draftResult:a.result,result:{...a.result,html:'<!doctype html><html><head></head><body>待验证代码，请使用新版客户端。</body></html>'}});
     }else Reflect.deleteProperty(project,'draftResult');
     const cloud:CloudProject={project,version:{code:(old?.cloud.version.code??0)+1,data:old?.cloud.version.data??1},state:old?.cloud.state??null,hasData:old?.cloud.hasData??false};
     rows.set(a.projectId,{owner:account,cloud});receipt={projectId:a.projectId,version:{...cloud.version},updatedAt:project.updatedAt};operations.set(key,receipt);
    }
    if(lost){lost=false;return route.abort('failed');}
    return route.fulfill({json:{...receipt,logProof:signProof({projectId:a.projectId})}});
   }
   if(url.pathname==='/api/projects/activate'){
    const row=rows.get(body.projectId)!;if(row.cloud.project.previewPolicy?.adoption!=='allowed')return route.fulfill({status:403,json:{error:'restricted'}});
    row.cloud.version.code++;row.cloud.project.previewPolicy.dataMode='formal';if(row.cloud.project.draftResult){row.cloud.project.result=row.cloud.project.draftResult;delete row.cloud.project.draftResult;}
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
 return {rows,connect,bodies,withoutProof:()=>{includeProof=false;},render:(value:typeof html)=>{render=value;},failGeneration:()=>{generationFail=true;},calls:()=>calls,loseSave:()=>{lost=true;},failLogs:(b:boolean)=>{logsFail=b;},restrict:(value:Artifact['policy'])=>{policy=value;},
  holdGeneration:()=>{generationGate=new Promise<void>(r=>{releaseGeneration=r;});},releaseGeneration:()=>{releaseGeneration();generationGate=undefined;},
  holdSave:()=>{saveGate=new Promise<void>(r=>{releaseSave=r;});},releaseSave:()=>{releaseSave();saveGate=undefined;}};
}
export async function login(page:Page,owner='owner-a') {
 const email=page.getByLabel('邮箱地址',{exact:true});if(await email.getAttribute('readonly')===null)await email.fill(owner+'@example.invalid');else await expect(email).toHaveValue(owner+'@example.invalid');await page.getByRole('button',{name:'发送验证码',exact:true}).click();
 await page.getByLabel('6 位验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并登录'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
}
export async function generate(page:Page){await page.goto('/');await page.getByLabel('你想做什么？').fill('Synthetic counter');await page.getByRole('button',{name:'开始生成',exact:true}).click();}
export const frame=(p:Page)=>p.frameLocator('iframe[title="生成的应用"]');
export const ready=(p:Page)=>p.getByText('云端已保存代码',{exact:false});
export async function modify(p:Page){await p.getByLabel('追加修改需求').fill('change');await p.getByRole('button',{name:'生成候选',exact:true}).click();await expect(p.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();}

