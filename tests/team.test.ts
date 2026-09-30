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
