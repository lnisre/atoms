import type { Route } from '@playwright/test';
import {createHash} from 'node:crypto';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export type Mode='minor'|'major'|'clean'|'data'|'unknown'|'fatal'|'resolved';
export async function respond(route:Route,mode:Mode) {
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
  return html;
}
