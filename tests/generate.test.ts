import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { authenticatedCookie, authProfile } from "./helpers/auth";
import { POST } from "../src/app/api/generate/route";
import { POST as commit } from "../src/app/api/projects/artifact/route";
import { prepareGeneration, verifyArtifact, attestArtifact } from "../src/lib/cloud-projects/artifacts";
import { syntheticArtifact } from "./helpers/artifact";
const oldFetch=globalThis.fetch,env={...process.env};
let cookie="";
const pid=crypto.randomUUID(), html='<!doctype html><html><head></head><body>official</body></html>';
const expected={code:2,data:3};
const project={id:pid,title:"fixture",requirement:"original",updatedAt:new Date().toISOString(),result:{html,model:"synthetic",durationMs:1,generatedAt:new Date().toISOString()}};
beforeEach(async()=>{cookie=await authenticatedCookie();process.env.ATOMS_INTERNAL_KEY='synthetic-internal';process.env.ATOMS_ARTIFACT_SECRET='b'.repeat(64);globalThis.fetch=async url=>String(url).endsWith('/user/me')?Response.json(authProfile):Response.json({project,version:expected,state:{privateBusiness:"MUST NOT REACH MODEL"},hasData:true});});
afterEach(()=>{globalThis.fetch=oldFetch;for(const k of ['ATOMS_INTERNAL_KEY','ATOMS_ARTIFACT_SECRET']){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}});
function request(body:unknown,owner=authProfile.sub){return new Request('http://localhost/api/generate',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-Atoms-Account':owner,'X-Atoms-Task-Id':crypto.randomUUID()},body:JSON.stringify(body)});}
test('compatibility and current protocols use the same account/project boundary; client code, owner and business records rejected',async()=>{
 for(const protocol of ['', 'atoms-team/3']) {
  for(const body of [{requirement:'old unconstrained call'}, {projectId:pid,modification:'x',expected,baseHtml:html,context:[]},{projectId:pid,requirement:'x',state:{secret:1}}]) {
   const req=request(body);if(protocol)req.headers.set('x-atoms-protocol',protocol);
   assert.equal((await POST(req)).status,400);
  }
 }
 assert.equal((await POST(request({projectId:pid,requirement:'new'},'other'))).status,403);
 const response=await POST(request({projectId:pid,modification:'change',expected}));assert.equal(response.status,200);
 const payload=JSON.parse((await response.json()).ticket.payload);assert.equal(payload.binding.input.baseHtml,html);assert.equal(payload.binding.ownerId,authProfile.sub);
 assert.doesNotMatch(JSON.stringify(payload),/privateBusiness|MUST NOT|synthetic-access/);
 assert.equal((await POST(request({projectId:pid,modification:'change',expected:{code:1,data:3}}))).status,409);
});
test('foreign project and stolen/tampered candidate cannot become a generation base or a saved artifact',async()=>{
 const identity={account:{id:authProfile.sub,email:authProfile.email},accessToken:'ordinary'};
 const fixture=syntheticArtifact(authProfile.sub,pid,crypto.randomUUID(),html.replace('official','candidate'),html,expected);
 const binding=await prepareGeneration(identity,{projectId:pid,modification:'second',expected,parent:fixture.proof},crypto.randomUUID());
 assert.equal(binding.input.baseHtml,fixture.artifact.result.html);assert.equal(binding.generations.length,1);
 assert.throws(()=>verifyArtifact(fixture.proof,'other'),/当前账号/);
 const tampered={...fixture.proof,payload:fixture.proof.payload.replace('candidate','forged')};
 assert.throws(()=>verifyArtifact(tampered,authProfile.sub),/产物已改变/);
 assert.equal((await commit(request({operationId:crypto.randomUUID(),proof:tampered}))).status,403);
 globalThis.fetch=async url=>String(url).endsWith('/user/me')?Response.json(authProfile):Response.json({code:'PT404'},{status:404});
 assert.equal((await POST(request({projectId:pid,modification:'change',expected}))).status,404);
});
test('attestation derives restrictions and records from trusted terminal output and rejects a forged final hash',async()=>{
 const taskId=crypto.randomUUID(),f=syntheticArtifact(authProfile.sub,pid,taskId,html);
 const binding={ownerId:authProfile.sub,taskId,input:{projectId:pid,requirement:'test'},expected:null,generations:[]};
 const proof=attestArtifact(binding,f.artifact.result,'explanation',f.team,[],Date.now());
 assert.equal(verifyArtifact(proof,authProfile.sub).policy.dataMode,'formal');
 assert.throws(()=>attestArtifact(binding,{...f.artifact.result,html:'forged'},'explanation',f.team,[],Date.now()));
});

test('real supervised process emits a terminal owner-bound proof; saved steps match actual server execution',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {startTeam}=await import('../src/lib/team/server');
 const taskId=crypto.randomUUID(),f=syntheticArtifact(authProfile.sub,pid,taskId,html);
 const deliveries=f.team.deliveries.map(d=>d.role==='Engineer'?{...d,content:JSON.stringify({...JSON.parse(d.content),html,assistantReply:'actual controlled fixture output'})}:d);
 const dir=await mkdtemp(join(tmpdir(),'atoms-68-runtime-')),file=join(dir,'controlled-runtime');
 await writeFile(file,`#!${process.execPath}\nprocess.stdin.once('data',()=>{const deliveries=${JSON.stringify(deliveries)};for(const [i,d]of deliveries.entries()){for(const status of ['started','completed'])process.stdout.write(JSON.stringify({type:'call',call:i+1,actor:d.role,requestedModel:'synthetic',status})+'\\n');process.stdout.write(JSON.stringify({type:'delivery',...d})+'\\n');}process.stdout.write(JSON.stringify({type:'result',html:${JSON.stringify(html)},assistantReply:'actual controlled fixture output',codeHash:${JSON.stringify(f.team.codeHash)}})+'\\n',()=>process.exit(0));});`,{mode:0o700});
 const oldPython=process.env.ATOMS_TEAM_PYTHON,oldModel=process.env.DEEPSEEK_API_KEY;
 process.env.ATOMS_TEAM_PYTHON=file;process.env.DEEPSEEK_API_KEY='synthetic-unused';
 try {
  const input={projectId:pid,requirement:'supervised synthetic task'};
  const req=request(input);req.headers.set('x-atoms-task-id',taskId);
  const r=await startTeam(req,Date.now(),authProfile.sub,{ownerId:authProfile.sub,taskId,input,expected:null,generations:[]});
  const wire=(await r.text()).trim().split('\n').map(l=>JSON.parse(l)),terminal=wire.at(-1);
  assert.equal(terminal.type,'result',terminal.error);assert.ok(terminal.proof);
  const a=verifyArtifact(terminal.proof,authProfile.sub);
  assert.deepEqual(a.initialGeneration?.events,wire.filter(m=>m.type==='step').map(m=>m.event));
  assert.equal(a.initialGeneration?.assistantReply,'actual controlled fixture output');assert.equal(a.policy.dataMode,'formal');
 }finally{if(oldPython===undefined)delete process.env.ATOMS_TEAM_PYTHON;else process.env.ATOMS_TEAM_PYTHON=oldPython;if(oldModel===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldModel;await rm(dir,{recursive:true,force:true});}
});
