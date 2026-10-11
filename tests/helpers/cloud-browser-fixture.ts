import { expect, type BrowserContext, type Page } from "@playwright/test";
import { syntheticArtifact } from "./artifact";
import { unresolvedDataIssues, type ReviewIssue } from "../../src/lib/team/review";
import { signProof } from "../../src/lib/cloud-projects/artifacts";
import type { Artifact } from "../../src/lib/cloud-projects/artifact-contract";
import type { CloudProject, CommitReceipt, HistorySnapshot } from "../../src/lib/cloud-projects/contract";
// Explicit in-memory Auth/BFF/provider seam. Real DOM and iframe; no email/model/PG claims.
const html=(revision:number)=>`<!doctype html><html><head></head><body><h1>Counter ${revision}</h1><button id="add" disabled>增加</button><output id="count"></output><p id="status"></p><script>
let state;const button=document.querySelector('#add'),out=document.querySelector('#count'),status=document.querySelector('#status');
atoms.loadState().then(value=>{state=value??{count:0};out.textContent=state.count;button.disabled=false}).catch(()=>status.textContent='读取失败');
button.onclick=async()=>{state.count++;out.textContent=state.count;status.textContent='保存中';try{await atoms.saveState(state);status.textContent='更新完成'}catch{status.textContent='保存失败'}};
</script></body></html>`;
export async function fixture() {
 process.env.ATOMS_ARTIFACT_SECRET='b'.repeat(64);
 const rows=new Map<string,{owner:string;cloud:CloudProject}>(),operations=new Map<string,CommitReceipt>();
 const histories=new Map<string,HistorySnapshot[]>(),backups=new Map<string,{cloud:CloudProject;points:HistorySnapshot[]}>();
 let historyFailure=0,historyLost=false,readbackFailure=false;
 function point(cloud:CloudProject,sequence:number):HistorySnapshot {
  return {projectId:cloud.project.id,project:structuredClone(cloud.project),state:structuredClone(cloud.state),hasData:cloud.hasData,
   entry:{id:crypto.randomUUID(),sequence,origin:sequence===1?'initial':'adopted',recordId:cloud.project.modificationRecords?.at(-1)?.id??null,summary:sequence===1?'首次计数器':`修改 ${sequence}`,pairedAt:new Date().toISOString(),dataSavedAt:cloud.hasData?new Date().toISOString():null,hasData:cloud.hasData,nextSequence:null,status:'current',protectedReason:'current'}};
 }
 let render=html, includeProof=true;
 let reviewIssues:ReviewIssue[]=[];
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
   const baseTeam=previous?.generations.at(-1)?.team??official?.modificationRecords?.at(-1)?.generations?.at(-1)?.team??official?.initialGeneration?.team;
   const f=syntheticArtifact(account,body.projectId,taskId,render(calls),base,body.expected,previous?.generations,reviewIssues,baseTeam ? unresolvedDataIssues(baseTeam) : []);
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
     const points=histories.get(a.projectId)??[];
     if(old && points.length){const last=points.at(-1)!;last.project=structuredClone(old.cloud.project);last.state=structuredClone(old.cloud.state);last.hasData=old.cloud.hasData;Object.assign(last.entry,{status:'available',protectedReason:null,hasData:old.cloud.hasData,dataSavedAt:new Date().toISOString(),pairedAt:new Date().toISOString(),nextSequence:last.entry.sequence+1});}
     cloud.historyRevision=old?.cloud.historyRevision??0;cloud.restore=null;backups.delete(a.projectId);points.forEach(s=>{s.entry.protectedReason=null;});points.push(point(cloud,(points.at(-1)?.entry.sequence??0)+1));histories.set(a.projectId,points);
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
   if(url.pathname.includes('/history')){
    const points=histories.get(id)??[];
    if(req.method()==='GET'){
     const snapshotId=url.pathname.split('/')[5];
     if(snapshotId){const snapshot=points.find(s=>s.entry.id===snapshotId && s.entry.status!=='cleared');return route.fulfill({status:snapshot?200:410,json:snapshot??{code:'PT410',error:'已清理，无法恢复'}});}
     return route.fulfill({json:{projectId:id,version:row.cloud.version,revision:row.cloud.historyRevision??0,currentId:points.at(-1)?.entry.id??null,entries:points.map(s=>s.entry).reverse()}});
    }
    bodies.push(body);const key=account+body.operationId;let receipt=operations.get(key);
    if(!receipt){
     if(historyFailure){const status=historyFailure;historyFailure=0;return route.fulfill({status,json:{code:status===507?'storage_full':'unavailable',error:status===507?'云端空间不足，本次操作未完成。':'操作失败，原状态保留。'}});}
     if(JSON.stringify(body.expected)!==JSON.stringify(row.cloud.version)||body.expectedHistory!==(row.cloud.historyRevision??0))return route.fulfill({status:409,json:{code:'conflict',error:'云端已有更新，请重新核对。'}});
     const target=points.find(s=>s.entry.id===body.targetId),backup=backups.get(id),old=row.cloud;
     if(body.action==='undo'){
      if(!backup||old.restore?.id!==body.targetId)return route.fulfill({status:412,json:{code:'PT412',error:'撤销机会已结束'}});
      row.cloud=structuredClone(backup.cloud);histories.set(id,structuredClone(backup.points));row.cloud.restore=null;backups.delete(id);
     }else{
      if(!target||target.entry.status==='cleared')return route.fulfill({status:410,json:{code:'PT410',error:'已清理，无法恢复'}});
      if(target.entry.status==='current'||(body.action==='clear'&&target.entry.protectedReason))return route.fulfill({status:423,json:{code:'PT423',error:'当前项目或撤销依赖，不能清理'}});
      if(body.action==='restore'){
       backups.set(id,{cloud:structuredClone(old),points:structuredClone(points)});
       row.cloud={...structuredClone(old),project:structuredClone(target.project),state:structuredClone(target.state),hasData:target.hasData,restore:{id:body.operationId,targetId:target.entry.id,sequence:target.entry.sequence,restoredAt:new Date().toISOString()}};
       const kept=points.filter(s=>s.entry.sequence<=target.entry.sequence);kept.forEach(s=>{s.entry.status=s===target?'current':'available';s.entry.protectedReason=s===target?'current':'undo';});histories.set(id,kept);
      }else{target.entry.status='cleared';target.entry.protectedReason=null;}
     }
     row.cloud.version=body.action==='clear'?{...old.version}:{code:old.version.code+1,data:old.version.data+1};row.cloud.historyRevision=(old.historyRevision??0)+1;
     row.cloud.project.updatedAt=new Date().toISOString();receipt={projectId:id,version:{...row.cloud.version},updatedAt:row.cloud.project.updatedAt};operations.set(key,receipt);
    }
    if(historyLost){historyLost=false;return route.abort('failed');}return route.fulfill({json:receipt});
   }
   if(url.pathname.endsWith('/data')){
    if(req.method()==='GET')return route.fulfill({json:{state:row.cloud.state,hasData:row.cloud.hasData,version:row.cloud.version}});
    if(JSON.stringify(body.expected)!==JSON.stringify(row.cloud.version))return route.fulfill({status:409,json:{code:'conflict',error:'云端已有更新，已拒绝覆盖。'}});
    row.cloud.state=body.state;row.cloud.hasData=true;row.cloud.version.data++;
    return route.fulfill({json:{projectId:id,version:row.cloud.version,updatedAt:new Date().toISOString()}});
   }
   if(readbackFailure){readbackFailure=false;return route.fulfill({status:503,json:{code:'unavailable',error:'提交后回读失败'}});}
   return route.fulfill({json:row.cloud});
  });
  return {expire:()=>{authenticated=false;},switchTo:(id:string)=>{account=id;authenticated=false;}};
 }
 return {rows,connect,bodies,histories,reviewIssues:(issues:ReviewIssue[])=>{reviewIssues=issues;},failHistory:(status=503)=>{historyFailure=status;},loseHistory:()=>{historyLost=true;},failReadback:()=>{readbackFailure=true;},withoutProof:()=>{includeProof=false;},render:(value:typeof html)=>{render=value;},failGeneration:()=>{generationFail=true;},calls:()=>calls,loseSave:()=>{lost=true;},failLogs:(b:boolean)=>{logsFail=b;},restrict:(value:Artifact['policy'])=>{policy=value;},
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

