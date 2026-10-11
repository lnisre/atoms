import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as list } from "../src/app/api/projects/[id]/history/route";
import { GET as read } from "../src/app/api/projects/[id]/history/[snapshotId]/route";
import { CloudWorkbenchSession } from "../src/lib/cloud-projects/workbench";
import { validateCloudValue, type CloudProject, type HistoryEntry, type HistorySnapshot } from "../src/lib/cloud-projects/contract";
import { authenticatedCookie, authProfile, authConfig } from "./helpers/auth";
import { syntheticArtifact } from "./helpers/artifact";

const oldFetch = globalThis.fetch, oldEnv = { ...process.env };
const id = "bd0f1e78-d1e0-4d72-9665-a5018539ba27", sid = "778a7aef-93ef-433d-b93c-a208f305aa0d";
const time = "2026-10-11T00:00:00.000Z";
const html = "<!doctype html><html><head></head><body>Historical V1</body></html>";
const project = {id,title:"history",requirement:"original",updatedAt:time,result:{html,model:"fixture",durationMs:0,generatedAt:time},previewPolicy:{status:"allowed",reasons:[],dataMode:"formal",adoption:"allowed",review:"clean"}} satisfies CloudProject["project"];
const cloud: CloudProject = {project,version:{code:2,data:4},state:{count:120},hasData:true};
const entry: HistoryEntry = {id:sid,sequence:1,origin:"initial",recordId:null,summary:"original",pairedAt:time,dataSavedAt:time,hasData:true,nextSequence:2,status:"available"};
const snapshot: HistorySnapshot = {projectId:id,entry,project,state:{count:100},hasData:true};
const history = {projectId:id,version:cloud.version,currentId:null,entries:[entry]};
beforeEach(() => {Object.assign(process.env,authConfig);process.env.ATOMS_ARTIFACT_SECRET="b".repeat(64);delete process.env.ATOMS_APP_ORIGIN;});
afterEach(() => {globalThis.fetch=oldFetch;for(const key of [...Object.keys(authConfig),"ATOMS_APP_ORIGIN","ATOMS_ARTIFACT_SECRET"]){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}});
const request = (cookie="",owner?:string) => new Request(`http://localhost/api/projects/${id}/history/${sid}`,{headers:{cookie,...(owner?{"X-Atoms-Account":owner}:{})}});
const ctx = {params:Promise.resolve({id,snapshotId:sid})};
test("history routes require verified identity, bind fixed IDs and forward only the ordinary token",async()=>{
 let rpcCalls=0,body:unknown;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/user/me'))return Response.json(authProfile);
  rpcCalls++;assert.equal(new Headers(options?.headers).get('authorization'),'Bearer synthetic-access');body=JSON.parse(String(options?.body));
  return Response.json(String(url).endsWith('atoms_list_history')?history:snapshot);
 };
 assert.equal((await list(request(),ctx)).status,401);assert.equal((await read(request(),ctx)).status,401);assert.equal(rpcCalls,0);
 const cookie=await authenticatedCookie();
 assert.equal((await list(request(cookie),ctx)).status,200);assert.deepEqual(body,{p_project_id:id});
 const response=await read(request(cookie),ctx);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(body,{p_project_id:id,p_snapshot_id:sid});assert.deepEqual(await response.json(),snapshot);
 assert.equal((await read(request(cookie,'other-owner'),ctx)).status,403);assert.equal(rpcCalls,2);
});
test("unavailable, restricted or malformed snapshots cannot turn into an executable empty trial",async()=>{
 const cookie=await authenticatedCookie();let value:unknown=snapshot,code='',status=200;
 globalThis.fetch=async url=>String(url).endsWith('/user/me')?Response.json(authProfile):Response.json(code?{code,message:'private SQL credential detail'}:value,{status});
 for(const bad of [{...snapshot,state:undefined},{...snapshot,entry:{...entry,hasData:false}},{...snapshot,projectId:crypto.randomUUID()}]){
  value=bad;assert.equal((await read(request(cookie),ctx)).status,503);
 }
 value={...snapshot,project:{...project,result:{...project.result,html:'<!doctype html><html><head></head><body><script>while(true){}</script></body></html>'}}};
 assert.equal((await read(request(cookie),ctx)).status,403);
 value={...snapshot,project:{...project,previewPolicy:{...project.previewPolicy,dataMode:'trial'}}};assert.equal((await read(request(cookie),ctx)).status,403);
 code='DATABASE_53100';status=500;assert.equal((await read(request(cookie),ctx)).status,507);
 for(const [error,http] of [['PT404',404],['PT410',410],['PT403',403],['PT507',507]] as const){code='DATABASE_'+error;status=http;const response=await read(request(cookie),ctx);assert.equal(response.status,http);assert.doesNotMatch(await response.text(),/private|credential|SQL/);}
});
test("history response validation keeps missing snapshots and malformed timestamps distinct from no business data",()=>{
 for(const value of [{...history,entries:[{...entry,pairedAt:'bad'}]},{...history,currentId:sid},{...history,entries:[entry,entry]}])assert.throws(()=>validateCloudValue('history',value));
 validateCloudValue('snapshot',{...snapshot,hasData:false,state:null,entry:{...entry,hasData:false,dataSavedAt:null}});
 assert.throws(()=>validateCloudValue('snapshot',{...snapshot,entry:{...entry,status:'cleared'}}));
});
test("history trial is a fresh copy and preserves official data, candidate and its trial across entry/exit",async()=>{
 let writes=0;
 globalThis.fetch=async(url,options)=>{if(options?.method!=='GET')writes++;return Response.json(String(url).endsWith('/history')?history:snapshot);};
 const session=new CloudWorkbenchSession('owner',id,structuredClone(cloud));
 const candidate=syntheticArtifact('owner',id,crypto.randomUUID(),html.replace('V1','candidate'),html,{code:2,data:4}).artifact;
 const trial={projectId:id,state:{count:999},hasData:true};session.state={...session.state,artifact:candidate,trial};
 await session.openHistory();await session.tryHistory(sid);
 assert.equal(session.state.historyTrial?.snapshot.project.result.html,html);
 assert.notEqual(session.state.historyTrial?.trial.state,session.state.historyTrial?.snapshot.state);
 session.state.historyTrial!.trial.state={count:101};
 assert.deepEqual(session.state.historyTrial!.snapshot.state,{count:100});assert.deepEqual(session.state.cloud?.state,{count:120});
 session.closeHistory();assert.equal(session.state.artifact,candidate);assert.equal(session.state.trial,trial);assert.deepEqual(trial.state,{count:999});
 await session.tryHistory(sid);assert.deepEqual(session.state.historyTrial?.trial.state,{count:100});assert.equal(writes,0);session.dispose();
});
test("close, selection changes and account disposal suppress stale history reads, even when transport ignores abort",async()=>{
 const pending:((r:Response)=>void)[]=[];globalThis.fetch=async()=>new Promise(resolve=>pending.push(resolve));
 const session=new CloudWorkbenchSession('owner',id,cloud);
 const old=session.tryHistory(sid);session.closeHistory();pending.shift()!(Response.json(snapshot));await old;assert.equal(session.state.historyTrial,undefined);
 const first=session.tryHistory(sid),second=session.tryHistory(sid);pending.shift()!(Response.json({...snapshot,state:{stale:true}}));await first;assert.equal(session.state.historyTrial,undefined);
 pending.shift()!(Response.json(snapshot));await second;assert.deepEqual(session.snapshot().historyTrial?.trial.state,{count:100});
 const late=session.openHistory();session.dispose();const before=session.state;pending.shift()!(Response.json(history));await late;assert.equal(session.state,before);
});
test("a failed historical read leaves candidate available and publishes no fabricated copy",async()=>{
 globalThis.fetch=async()=>Response.json({code:'unavailable',error:'read failed'},{status:503});
 const session=new CloudWorkbenchSession('owner',id,cloud);const trial={projectId:id,state:{count:88},hasData:true};session.state.trial=trial;
 await session.tryHistory(sid);assert.equal(session.state.historyError,'read failed');assert.equal(session.state.historyTrial,undefined);assert.equal(session.state.trial,trial);session.dispose();
});

test("adoption committed but failed readback keeps the exact operation and candidate through retry",async()=>{
 const previousWindow=globalThis.window;
 Object.defineProperty(globalThis,'window',{configurable:true,value:{history:{replaceState(){}}}});
 const session=new CloudWorkbenchSession('owner',id,cloud);
 const candidate=syntheticArtifact('owner',id,crypto.randomUUID(),html.replace('V1','candidate'),html,{code:2,data:4});
 session.state={...session.state,artifact:candidate.artifact,proof:candidate.proof};
 let reads=0;const bodies:string[]=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/artifact')){bodies.push(String(options?.body));return Response.json({projectId:id,version:{code:3,data:4},updatedAt:time});}
  if(++reads===1)return Response.json({error:'readback failed'},{status:503});
  return Response.json({...cloud,version:{code:3,data:4},project:{...project,result:candidate.artifact.result}});
 };
 try {
  await session.commit();assert.equal(session.state.error,'readback failed');assert.ok(session.state.pending);assert.equal(session.state.artifact,candidate.artifact);
  await session.retry();assert.equal(bodies[0],bodies[1]);assert.equal(session.state.pending,undefined);assert.equal(session.state.artifact,undefined);assert.equal(session.state.cloud?.version.code,3);
 } finally {session.dispose();if(previousWindow===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',{configurable:true,value:previousWindow});}
});
