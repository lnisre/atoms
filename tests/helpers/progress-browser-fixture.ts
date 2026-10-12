import { createHash } from 'node:crypto';
import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import { syntheticArtifact } from './artifact';
import { signProof } from '../../src/lib/cloud-projects/artifacts';
import type { TeamRecord, Delivery, TeamOutcome } from '../../src/lib/team/contract';
import type { Artifact } from '../../src/lib/cloud-projects/artifact-contract';
import type { fixture } from './cloud-browser-fixture';

// Controlled external transport; real readTeam validation, workbench, iframe and
// cloud fixture. This never claims to execute a provider or stop a real process.
export async function progressFixture(page: Page, store: Awaited<ReturnType<typeof fixture>>, enabled = true) {
 let socket: WebSocketRoute | undefined, started=false, calls=0, heartbeats=0, closed=false;
 let team: TeamRecord, artifact: Artifact, html='';
 let request: {projectId:string;expected?:{code:number;data:number};parent?:{payload:string}};
 let base: string|undefined, previous: Artifact|undefined;
 const send=(value:object)=>socket!.send(JSON.stringify(value));
 await page.route('**/api/generate',async route=>{
  if (!enabled) return route.fallback();
  calls++;started=false;closed=false;request=route.request().postDataJSON();
  const taskId=route.request().headers()['x-atoms-task-id'];
  previous=request.parent ? JSON.parse(request.parent.payload) : undefined;
  const project=store.rows.get(request.projectId)?.cloud.project;
  base=previous?.result.html ?? project?.draftResult?.html ?? project?.result.html;
  team={protocol:'atoms-team/3',taskId,projectId:request.projectId,deliveries:[],calls:[],...(base?{baseCodeHash:createHash('sha256').update(base).digest('hex'),baseDataIssues:[]}: {})};
  await route.fulfill({json:{protocol:'atoms-team/3',transport:'websocket',taskId,ticket:'synthetic-no-provider'}});
 });
 await page.routeWebSocket('**/api/team/socket',ws=>{
  socket=ws;
  ws.onClose(()=>{closed=true;});
  ws.onMessage(raw=>{
   const message=JSON.parse(String(raw));
   if(message.action==='start') {send({type:'session',protocol:'atoms-team/3',taskId:team.taskId,projectId:team.projectId,token:'synthetic'});started=true;}
   else if(message.action==='heartbeat'){heartbeats++;send({type:'control-ack',id:message.id,ok:true});}
  });
 });
 function call(actor:string) { const call={call:team.calls.length+1,actor,requestedModel:'synthetic',status:'started' as const};team.calls.push(call);send({type:'call',taskId:team.taskId,call}); }
 function completed() {const call={...team.calls.at(-1)!,status:'completed' as const};team.calls[team.calls.length-1]=call;send({type:'call',taskId:team.taskId,call});}
 function delivery(role:Delivery['role'],value:object) {const delivery={role,content:JSON.stringify(value)};team.deliveries.push(delivery);if(role==='Engineer')delete team.review;send({type:'delivery',taskId:team.taskId,delivery});}
 function assign(to:string) {call('Mike');completed();delivery('Mike',{command:'assign',to});}
 function build() {
  const f=syntheticArtifact('owner-a',team.projectId,team.taskId,html,base,request.expected,previous?.generations);
  artifact=f.artifact;
  if(previous)artifact.baseHash=previous.baseHash;
  const record=artifact.initialGeneration ?? artifact.generations.at(-1)!;record.team=structuredClone(team);
  return f;
 }
 return {
  enable:()=>{enabled=true;},
  connected:()=>expect.poll(()=>started).toBe(true), calls:()=>calls, heartbeats:()=>heartbeats, closed:()=>closed,
  call,completed,assign,delivery,
  requirements(){assign('Requirements');call('Requirements');completed();delivery('Requirements',{requirements:[{id:'counter',description:'Synthetic counter'}]});},
  engineerStart(){assign('Engineer');call('Engineer');},
  engineerDeliver(iteration=1){
   html=`<!doctype html><html><head></head><body><h1>Progress ${iteration}</h1><button id="add" disabled>增加</button><output id="count"></output><script>let n=0;atoms.loadState().then(s=>{n=s?.count??0;document.querySelector('#count').textContent=n;document.querySelector('#add').disabled=false});document.querySelector('#add').onclick=async()=>{document.querySelector('#count').textContent=++n;await atoms.saveState({count:n})}</script></body></html>`;
   completed();delivery('Engineer',{codeHash:createHash('sha256').update(html).digest('hex'),iteration});
  },
  artifact(){team.codeHash=JSON.parse(team.deliveries.findLast(d=>d.role==='Engineer')!.content).codeHash;build();send({type:'artifact',protocol:'atoms-team/3',taskId:team.taskId,team,result:artifact.result,assistantReply:'Synthetic explanation'});},
  reviewerStart(){assign('Reviewer');call('Reviewer');},
  review(major=false){completed();const review={kind:'code-review' as const,schemaVersion:1 as const,taskId:team.taskId,codeHash:team.codeHash!,approved:!major,summary:major?'Synthetic major finding':'Synthetic review',resolutions:[],issues:major?[{id:'counter',severity:'major' as const,category:'functionality' as const,codeQuote:'<h1>',trigger:'synthetic trigger',consequence:'synthetic consequence'}]:[]};delivery('Reviewer',review);team.review=review;},
  finish(outcome:TeamOutcome='passed',error?:string,policy?:Artifact['policy']){
   if(outcome==='passed'||outcome==='issues'){call('Mike');completed();delivery('Mike',{command:'finish'});}
   team.outcome=outcome;build();if(policy)artifact.policy=policy;
   send({type:outcome==='passed'||outcome==='issues'?'result':'error',protocol:'atoms-team/3',taskId:team.taskId,team,result:artifact.result,assistantReply:'Synthetic explanation',error,outcome,proof:signProof(artifact)});
   socket!.close({code:1000});
  },
  fail(outcome:TeamOutcome,error:string){send({type:'error',taskId:team.taskId,outcome,error});socket!.close({code:1000});},
  disconnect(){socket!.close({code:1011,reason:'synthetic connection failure'});},
 };
}
