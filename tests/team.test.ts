import assert from "node:assert/strict";
import { test } from "node:test";
import { completePlan, mandatoryScenarios, type Specification } from "../src/lib/team/contract";
import { validateRequest, validateResult, expected, type ToolRequest } from "../src/lib/qa/contract";
import { startTeam, teamControl } from "../src/lib/team/server";
const spec: Specification = { summary: "counter", requirements: [{id:"increment",description:"increment and persist"}], probe:{seed:{count:1},prepare:[],commitSelector:"#add",changed:{path:["count"],equals:2}} };
const business = [{id:"increment",seed:{count:1},checks:[{id:"click",label:"click",command:{op:"click" as const,selector:"#add"}},{id:"data",label:"saved",command:{op:"data" as const,path:["count"],equals:2}}]}];
test("platform rules are appended independently; missing or renamed business checks reject",()=>{
  const plan = completePlan(spec,business);
  assert.equal(plan.length,4);
  assert.deepEqual(plan.slice(0,3),mandatoryScenarios(spec));
  assert.throws(()=>completePlan(spec,[]));
  assert.throws(()=>completePlan(spec,[{...business[0],id:"easier"}]));
  assert.throws(()=>completePlan(spec,[{...business[0],checks:business[0].checks.slice(0,1)}]));
});
test("request bound evidence rejects omissions, wrong task, stale hash and weakened expected values",()=>{
  const request: ToolRequest={protocol:"atoms-qa/1",taskId:"task",requestId:"request",html:"html",codeHash:"a".repeat(64),planHash:"b".repeat(64),deadline:Date.now()+10000,scenarios:completePlan(spec,business)};
  validateRequest(request);
  const result={protocol:request.protocol,taskId:request.taskId,requestId:request.requestId,codeHash:request.codeHash,planHash:request.planHash,status:"passed" as const,detail:"synthetic protocol fixture",results:request.scenarios.flatMap(s=>s.checks.map(c=>({scenarioId:s.id,checkId:c.id,command:c.command,expected:expected(c.command),actual:expected(c.command),status:"passed" as const,startedAt:1,endedAt:2})))};
  assert.equal(validateResult(request,result),true);
  for(const corrupt of [{...result,taskId:"old"},{...result,codeHash:"c".repeat(64)},{...result,results:result.results.slice(1)},{...result,results:result.results.map((r,i)=>i? r:{...r,expected:"weakened"})}]) assert.equal(validateResult(request,corrupt),false);
});
test("HTTP boundary rejects opaque origin, malformed first tasks and missing task owners without model calls",async()=>{
  const cross=await startTeam(new Request("http://localhost/api/generate",{method:"POST",headers:{origin:"null"}}));assert.equal(cross.status,403);
  const invalid=await startTeam(new Request("http://localhost/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:'{}'}));assert.equal(invalid.status,400);
  const late=await teamControl(new Request("http://localhost/api/team",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"tool-result",taskId:"old",token:"old",result:{status:"passed"}})}));assert.equal(late.status,410);
});
test("a missing Python executable emits an explicit terminal error, never a result",async()=>{
  const oldPython=process.env.ATOMS_TEAM_PYTHON, oldKey=process.env.DEEPSEEK_API_KEY;
  process.env.ATOMS_TEAM_PYTHON='/nonexistent/atoms-team-python';process.env.DEEPSEEK_API_KEY='offline-placeholder';
  try {
    const response=await startTeam(new Request('http://localhost/api/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Atoms-Task-Id':crypto.randomUUID()},body:JSON.stringify({projectId:crypto.randomUUID(),requirement:'zero-model process failure'})}));
    const messages=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(messages.at(-1).type,'error');assert.equal(messages.some(m=>m.type==='result'),false);assert.equal(messages.some(m=>m.type==='call'),false);
  } finally { if(oldPython===undefined)delete process.env.ATOMS_TEAM_PYTHON;else process.env.ATOMS_TEAM_PYTHON=oldPython;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey; }
});


test("review gate binds approval to this code and all four roles", async () => {
  const { validReview, reviewedTeam } = await import("../src/lib/team/review");
  const codeHash="a".repeat(64), review={kind:"code-review",taskId:"task",codeHash,approved:true,summary:"静态审查通过",issues:[]};
  assert.equal(validReview(review,codeHash),true);
  for (const bad of [{...review,codeHash:"b".repeat(64)},{...review,approved:"true"},{...review,issues:["缺少保存"]},{...review,summary:" "},{...review,issues:null},{...review,extra:true}]) assert.equal(validReview(bad,codeHash),false);
  const assign = (to:string) => ({role:"Mike" as const,content:JSON.stringify({command:"assign",to})});
  const deliveries = [assign("Requirements"),{role:"Requirements" as const,content:JSON.stringify({requirements:[{id:"increment"}]})},assign("Engineer"),{role:"Engineer" as const,content:JSON.stringify({codeHash})},assign("Reviewer"),{role:"Reviewer" as const,content:JSON.stringify(review)},{role:"Mike" as const,content:JSON.stringify({command:"finish"})}];
  const team={protocol:"atoms-team/2" as const,taskId:"task",projectId:"project",codeHash,review:{...review,kind:"code-review" as const},calls:deliveries.map((d,i)=>({actor:d.role,call:i+1,status:"completed" as const,requestedModel:"fixture"})),deliveries};
  assert.equal(reviewedTeam(team,codeHash),true);
  assert.equal(reviewedTeam({...team,calls:team.calls.slice(0,3)},codeHash),false);
  assert.equal(reviewedTeam({...team,review:{...team.review,approved:false,issues:["缺少核心功能"]}},codeHash),false);
  assert.equal(reviewedTeam({...team,protocol:"atoms-team/1"},codeHash),false);
});

test("handoff gate rejects stale approval, unchanged code, second repair and wrong task", async () => {
  const { inspectDeliveries, reviewedTeam } = await import("../src/lib/team/review");
  const a="a".repeat(64), b="b".repeat(64), c="c".repeat(64);
  const d=(role:"Mike"|"Requirements"|"Engineer"|"Reviewer",value:unknown)=>({role,content:JSON.stringify(value)});
  const assign=(to:string)=>d("Mike",{command:"assign",to});
  const review=(codeHash:string,approved:boolean)=>({kind:"code-review" as const,taskId:"task",codeHash,approved,summary:"concrete fixture finding",issues:approved?[]:["count+=2 increments twice on click"]});
  const first=[assign("Requirements"),d("Requirements",{requirements:[{id:"increment"}]}),assign("Engineer"),d("Engineer",{codeHash:a}),assign("Reviewer"),d("Reviewer",review(a,false))];
  const repaired=[...first,assign("Engineer"),d("Engineer",{codeHash:b}),assign("Reviewer"),d("Reviewer",review(b,true)),d("Mike",{command:"finish"})];
  const team={protocol:"atoms-team/2" as const,taskId:"task",projectId:"project",codeHash:b,review:review(b,true),deliveries:repaired,calls:repaired.map((item,i)=>({actor:item.role,call:i+1,status:"completed" as const,requestedModel:"fixture"}))};
  assert.equal(reviewedTeam(team,b),true);
  assert.equal(reviewedTeam({...team,outcome:"failed"},b),false);
  assert.equal(reviewedTeam({...team,deliveries:[...repaired.slice(0,-1),d("Mike",{command:"abort"})]},b),false);
  assert.equal(reviewedTeam({...team,calls:[...team.calls,{...team.calls[0],call:21}]},b),false);
  assert.equal(reviewedTeam({...team,review:review(a,true)},b),false);
  assert.equal(reviewedTeam({...team,taskId:"old-task"},b),false);
  assert.throws(()=>inspectDeliveries("task",[...first,assign("Reviewer")]));
  assert.throws(()=>inspectDeliveries("task",[...first,assign("Engineer"),d("Engineer",{codeHash:a})]));
  assert.throws(()=>inspectDeliveries("task",[...repaired.slice(0,-2),d("Reviewer",review(b,false)),assign("Engineer"),d("Engineer",{codeHash:c})]));
});

test("cancel and original deadline terminate the actual supervised process", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { TEAM_TIMEOUT_MS } = await import("../src/lib/team/contract");
  const dir=await mkdtemp(join(tmpdir(),"atoms26-cancel-")), executable=join(dir,"controlled-runtime"), pidFile=join(dir,"pid");
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');process.stdin.once('data',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));});setTimeout(()=>{},30000);`,{mode:0o700});
  const oldPython=process.env.ATOMS_TEAM_PYTHON, oldKey=process.env.DEEPSEEK_API_KEY;
  process.env.ATOMS_TEAM_PYTHON=executable;process.env.DEEPSEEK_API_KEY="offline-no-provider";
  try {
    for (const action of ["cancel","deadline"]) {
      await rm(pidFile,{force:true});
      const taskId=crypto.randomUUID();
      const request=new Request("http://localhost/api/generate",{method:"POST",headers:{"Content-Type":"application/json","X-Atoms-Task-Id":taskId},body:JSON.stringify({projectId:crypto.randomUUID(),requirement:"controlled hanging execution"})});
      const response=await startTeam(request,action==="deadline"?Date.now()-TEAM_TIMEOUT_MS+10000:Date.now());
      const reader=response.body!.getReader(), decoder=new TextDecoder();let wire="";
      const first=await reader.read();wire+=decoder.decode(first.value);const session=JSON.parse(wire.trim().split("\n").find(line=>JSON.parse(line).type==="session")!);
      let pid=0;
      for(let i=0;i<200&&!pid;i++){await new Promise(resolve=>setTimeout(resolve,25));pid=Number(await readFile(pidFile,"utf8").catch(()=>"0"));}
      assert.ok(pid>0, `controlled process did not start before readiness window (${action})`);
      if(action==="cancel") {const cancelled=await teamControl(new Request("http://localhost/api/team",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"cancel",taskId,token:session.token})}));assert.equal(cancelled.status,200);}
      while(true){const chunk=await reader.read();wire+=decoder.decode(chunk.value);if(chunk.done)break;}
      const messages=wire.trim().split("\n").map(line=>JSON.parse(line));assert.equal(messages.at(-1).outcome,action==="cancel"?"stopped":"limit");assert.equal(messages.some(m=>m.type==="result"),false);
      await new Promise(resolve=>setTimeout(resolve,30));assert.throws(()=>process.kill(pid,0));
      const late=await teamControl(new Request("http://localhost/api/team",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"heartbeat",taskId,token:session.token})}));assert.equal(late.status,410);
    }
  } finally {if(oldPython===undefined)delete process.env.ATOMS_TEAM_PYTHON;else process.env.ATOMS_TEAM_PYTHON=oldPython;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;await rm(dir,{recursive:true,force:true});}
});


test("modification input admits complete large code but rejects missing context and business records", async () => {
  const { validTeamInput } = await import("../src/lib/team/input");
  const input = {projectId:crypto.randomUUID(),requirement:"counter",modification:"add reset",baseHtml:"<!DOCTYPE html><html><head></head><body>"+"x".repeat(40000)+"</body></html>",context:["add decrement"]};
  assert.equal(validTeamInput(input),true);
  for (const bad of [{...input,context:undefined},{...input,baseHtml:"fragment"},{...input,state:{count:123}},{...input,context:["x".repeat(32001)]}]) assert.equal(validTeamInput(bad),false);
});


test("adoption rejects wrong project, stale final code and broken successful-round lineage before storage", async () => {
  const { adoptCandidate } = await import("../src/lib/project-store");
  const { createHash } = await import("node:crypto");
  const projectId=crypto.randomUUID(), taskId=crypto.randomUUID();
  const html="<!DOCTYPE html><html><head></head><body>latest</body></html>";
  const codeHash=createHash("sha256").update(html).digest("hex");
  const review={kind:"code-review" as const,taskId,codeHash,approved:true,summary:"fixture",issues:[]};
  const assign=(to:string)=>({role:"Mike" as const,content:JSON.stringify({command:"assign",to})});
  const deliveries=[assign("Requirements"),{role:"Requirements" as const,content:JSON.stringify({requirements:[{id:"x"}]})},assign("Engineer"),{role:"Engineer" as const,content:JSON.stringify({codeHash})},assign("Reviewer"),{role:"Reviewer" as const,content:JSON.stringify(review)},{role:"Mike" as const,content:JSON.stringify({command:"finish"})}];
  const team={protocol:"atoms-team/2" as const,taskId,projectId,codeHash,baseCodeHash:"a".repeat(64),review,deliveries,calls:deliveries.map((d,i)=>({call:i+1,actor:d.role,status:"completed" as const,requestedModel:"fixture"}))};
  const generation={taskId,projectId,requirement:"change",outcome:"complete" as const,startedAt:"now",assistantReply:"changed",events:[],team};
  const result={html:html.replace("latest","stale"),model:"fixture",durationMs:1,generatedAt:"now"};
  await assert.rejects(adoptCandidate(projectId,result,["change"],[generation]),/最后成功任务/);
  await assert.rejects(adoptCandidate("other",result,["change"],[generation]),/项目或需求/);
  await assert.rejects(adoptCandidate(projectId,{...result,html},["change","change"],[generation,generation]),/来源不连续/);
});

test("bounded read-only observations keep exact expectations at the tool boundary", () => {
  const request: ToolRequest = { protocol: 'atoms-qa/1', taskId: 'wait-task', requestId: 'wait-request', html: 'html', codeHash: 'a'.repeat(64), planHash: 'b'.repeat(64), deadline: Date.now() + 10000,
    scenarios: [{ id: 'settlement', seed: null, checks: [{ id: 'saved', label: 'actual settlement', command: { op: 'wait-for', selector: '[data-atoms-status]', property: 'text', equals: '已保存' } }] }] };
  validateRequest(request);
  const malformed = structuredClone(request);
  Reflect.deleteProperty(malformed.scenarios[0].checks[0].command, 'equals');
  assert.throws(() => validateRequest(malformed), /missing expectation/);
  const row = { scenarioId: 'settlement', checkId: 'saved', command: request.scenarios[0].checks[0].command, expected: '已保存', actual: '正在保存', status: 'passed' as const, startedAt: 1, endedAt: 2 };
  assert.equal(validateResult(request, { protocol: request.protocol, taskId: request.taskId, requestId: request.requestId, codeHash: request.codeHash, planHash: request.planHash, status: 'passed', detail: 'forged early settlement', results: [row] }), false);
});
