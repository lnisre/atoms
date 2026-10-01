import assert from "node:assert/strict";
import {test} from "node:test";
import {createHash} from "node:crypto";
import {artifactTeam,inspectDeliveries,validClassifiedReview,unresolvedDataIssues,type ReviewIssue} from "../src/lib/team/review";
import {executionBlockers,previewPolicy} from "../src/lib/team/preview-policy";
import {readTeam} from "../src/lib/team/client";
import {TeamError,type Delivery,type TeamRecord} from "../src/lib/team/contract";
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const document=(code:string)=>`<!doctype html><html><head></head><body><script>${code}</script></body></html>`;
const issue:ReviewIssue={id:'increment',severity:'major',category:'functionality',codeQuote:'count+=2',trigger:'click',consequence:'adds two'};
function teamFixture(rounds=1, issueValue:ReviewIssue|null=issue) {
  const taskId=crypto.randomUUID(),projectId=crypto.randomUUID();
  const deliveries:Delivery[]=[];
  const d=(role:Delivery['role'],value:unknown)=>deliveries.push({role,content:JSON.stringify(value)});
  const assign=(to:string)=>d('Mike',{command:'assign',to});
  assign('Requirements');d('Requirements',{requirements:[{id:'increment'}]});
  let html='',review;
  for(let i=1;i<=rounds;i++) {
    html=document('let count=0;count+=2;')+' '.repeat(i);
    assign('Engineer');d('Engineer',{codeHash:hash(html),iteration:i,assistantReply:'fixture'});
    review={kind:'code-review' as const,schemaVersion:1 as const,taskId,codeHash:hash(html),approved:!issueValue,summary:'fixture',issues:issueValue?[issueValue]:[],resolutions:[]};
    assign('Reviewer');d('Reviewer',review);
  }
  d('Mike',{command:'finish'});
  const team:TeamRecord={protocol:'atoms-team/3',taskId,projectId,codeHash:hash(html),review,deliveries,outcome:issueValue?'issues':'passed',calls:deliveries.map((v,i)=>({call:i+1,actor:v.role,status:'completed',requestedModel:'offline'}))};
  return {html,team};
}
test('three implementations (two repairs) may finish with major nonfatal findings; fourth is rejected',()=>{
  const {html,team}=teamFixture(3);
  assert.equal(artifactTeam(team,hash(html),true),true);
  assert.equal(previewPolicy(team,html).status,'allowed');
  assert.equal(inspectDeliveries(team.taskId,team.deliveries,team.protocol).iterations,3);
  assert.throws(()=>inspectDeliveries(team.taskId,[...team.deliveries.slice(0,-1),{role:'Mike',content:JSON.stringify({command:'assign',to:'Engineer'})}],team.protocol),/两次返工/);
});
test('review evidence is bound to current code; unsupported fatal labels cannot block preview',()=>{
  const {html,team}=teamFixture();
  assert.equal(validClassifiedReview(team.review,hash(html),html),true);
  assert.equal(validClassifiedReview({...team.review,issues:[{...issue,severity:'fatal'}]},hash(html),html),false);
  assert.equal(validClassifiedReview({...team.review,issues:[{...issue,codeQuote:'not present'}]},hash(html),html),false);
  assert.equal(artifactTeam({...team,taskId:'other'},hash(html),true),false);
  assert.equal(artifactTeam({...team,codeHash:'0'.repeat(64)},hash(html),true),false);
});
test('minor does not authorize repair; data risk permits trial but not adoption',()=>{
  const {html,team}=teamFixture(1,{...issue,severity:'minor'});
  assert.throws(()=>inspectDeliveries(team.taskId,[...team.deliveries.slice(0,-1),{role:'Mike',content:'{"command":"assign","to":"Engineer"}'}],team.protocol));
  const data=teamFixture(1,{...issue,category:'data-loss'});
  assert.deepEqual(previewPolicy(data.team,data.html),{status:'allowed',reasons:[],review:'issues',dataMode:'trial',adoption:'blocked'});
  assert.equal(previewPolicy(team,html).adoption,'allowed');
});
test('changing code without a resolution cannot erase data risk; current-code resolution can',()=>{
  const {html,team}=teamFixture(1,null);
  team.baseDataIssues=[{...issue,category:'persistence'}];
  assert.equal(previewPolicy(team,html).adoption,'blocked');
  const review={...team.review!,schemaVersion:1 as const,resolutions:[{id:issue.id,codeQuote:'count+=2',explanation:'synthetic resolution'}]};
  const item=team.deliveries.find(d=>d.role==='Reviewer')!;item.content=JSON.stringify(review);team.review=review;
  assert.equal(unresolvedDataIssues(team).length,0);
  assert.equal(previewPolicy(team,html).adoption,'allowed');
});
test('only platform structural and proven empty-loop rules block; normal errors, strings, finite loops do not',()=>{
  for(const code of ['while(true){}','for(;;);']) assert.equal(executionBlockers(document(code)).length,1);
  for(const code of ['const text="while(true){}"','// while(true){}','for(let i=0;i<3;i++){}','while(true){break}','function unused(){while(true){}}','throw new Error("ordinary error")']) assert.equal(executionBlockers(document(code)).length,0,code);
  assert.equal(executionBlockers('<html><body>truncated').length,1);
});
test('client keeps a complete artifact on local deadline but not on explicit stop or malformed terminal',async()=>{
  Reflect.set(globalThis,'window',{addEventListener(){},removeEventListener(){}});
  const {html,team}=teamFixture();
  const partial={...team,review:undefined,outcome:undefined,deliveries:team.deliveries.slice(0,4),calls:team.calls.slice(0,4)};
  const result={html,model:'offline',durationMs:1,generatedAt:'fixture'};
  for(const mode of ['limit','stopped','corrupt']) {
    const controller=new AbortController();
    let wire:ReadableStreamDefaultController<Uint8Array>;
    const stream=new ReadableStream<Uint8Array>({start(c){wire=c;const send=(m:unknown)=>c.enqueue(new TextEncoder().encode(JSON.stringify(m)+'\n'));send({type:'session',protocol:team.protocol,taskId:team.taskId,projectId:team.projectId,token:'offline'});send({type:'artifact',protocol:team.protocol,taskId:team.taskId,team:partial,result,assistantReply:'fixture'});}});
    const promise=readTeam(new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}}),team.taskId,team.projectId,controller.signal,()=>{},()=>{});
    // Let the parser validate the complete artifact before ending the stream.
    await new Promise(r=>setTimeout(r,30));
    if(mode==='corrupt'){wire!.enqueue(new TextEncoder().encode('{not json}\n'));wire!.close();await assert.rejects(promise);}
    else {controller.abort(new TeamError(mode as 'limit'|'stopped','fixture'));if(mode==='limit'){const value=await promise;assert.equal(value.result.html,html);assert.equal(value.team.outcome,'limit');}else await assert.rejects(promise);}
  }
});
