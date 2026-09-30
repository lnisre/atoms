import { createHash, randomUUID } from "node:crypto";
import type { Route } from "@playwright/test";
import type { GenerationResult } from "../../src/lib/generation";
// Explicitly synthetic team protocol for existing UI/storage regressions.
// It runs only a real page-presence probe, NOT the product's mandatory QA.
// Real four-role / full business acceptance is tested separately via live HTTP.
export async function fulfillGeneration(route: Route, options: NonNullable<Parameters<Route["fulfill"]>[0]>) {
  if (route.request().headers()["x-atoms-protocol"] !== "atoms-team/1" || (options.status && options.status >= 400)) return route.fulfill(options);
  let result: GenerationResult | undefined, assistantReply: string | null = null;
  if (options.json?.html) { result = options.json; assistantReply = options.json.assistantReply ?? null; }
  else if (typeof options.body === "string") {
    try {
      const messages = options.body.trim().split("\n").map(line => JSON.parse(line));
      const end = messages.at(-1);
      if (end.type === "result" && end.taskId === route.request().headers()["x-atoms-task-id"] && end.result.html.endsWith("</html>")) { result = end.result; assistantReply = end.assistantReply; }
    } catch { /* malformed response stays malformed */ }
  }
  if (!result) return route.fulfill(options);
  const taskId = route.request().headers()["x-atoms-task-id"], projectId = route.request().postDataJSON().projectId;
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const command = { op:"assert",selector:"body",property:"count",equals:1 };
  const scenarios = [{ id:"fixture-only",seed:null,checks:[{id:"presence",label:"synthetic regression page presence",command}] }];
  const request = { protocol:"atoms-qa/1",taskId,requestId:randomUUID(),codeHash:hash(result.html),planHash:hash(JSON.stringify(scenarios)),deadline:Date.now()+240000,html:result.html,scenarios };
  const check = {protocol:request.protocol,taskId,requestId:request.requestId,codeHash:request.codeHash,planHash:request.planHash,status:"passed",detail:"SYNTHETIC PROTOCOL FIXTURE, not business acceptance",results:[{scenarioId:"fixture-only",checkId:"presence",command,expected:1,actual:1,status:"passed",startedAt:1,endedAt:2}]};
  const team = {protocol:"atoms-team/1",taskId,projectId,deliveries:[],calls:[],check,codeHash:request.codeHash};
  await route.request().frame().page().route("**/api/team", r => r.fulfill({json:{ok:true}}));
  const messages = [{type:"session",protocol:"atoms-team/1",taskId,projectId,token:"synthetic-fixture",deadline:request.deadline},{type:"tool",taskId,envelope:{request,ticket:"synthetic-fixture"}},{type:"result",protocol:"atoms-team/1",taskId,team,result,assistantReply}];
  return route.fulfill({contentType:"application/x-ndjson",body:messages.map(m=>JSON.stringify(m)).join("\n")+"\n"});
}
