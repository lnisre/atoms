import { createHash } from "node:crypto";
import type { Route } from "@playwright/test";
import type { GenerationResult } from "../../src/lib/generation";
// Explicitly synthetic team protocol for existing UI/storage regressions.
// Reviews and role records are synthetic fixtures, not live model evidence.
export async function fulfillGeneration(route: Route, options: NonNullable<Parameters<Route["fulfill"]>[0]>) {
  if (route.request().headers()["x-atoms-protocol"] !== "atoms-team/2" || (options.status && options.status >= 400)) return route.fulfill(options);
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
  const codeHash = hash(result.html);
  const review = {kind:"code-review",taskId,codeHash,approved:true,summary:"SYNTHETIC REVIEW FIXTURE",issues:[]};
  const assign = (to: string) => ({role:"Mike",content:JSON.stringify({command:"assign",to,reason:"synthetic fixture",instruction:"synthetic fixture"})});
  const deliveries = [assign("Requirements"),{role:"Requirements",content:JSON.stringify({requirements:[{id:"synthetic",description:"synthetic"}]})},assign("Engineer"),{role:"Engineer",content:JSON.stringify({codeHash})},assign("Reviewer"),{role:"Reviewer",content:JSON.stringify(review)},{role:"Mike",content:JSON.stringify({command:"finish"})}];
  const team = {...(route.request().postDataJSON().baseHtml ? {baseCodeHash:hash(route.request().postDataJSON().baseHtml)} : {}),protocol:"atoms-team/2",taskId,projectId,codeHash,review,deliveries,
    calls:deliveries.map((d,i)=>({call:i+1,actor:d.role,requestedModel:"fixture",status:"completed"}))};
  await route.request().frame().page().route("**/api/team", r => r.fulfill({json:{ok:true}}));
  const messages = [{type:"session",protocol:"atoms-team/2",taskId,projectId,token:"synthetic-fixture",deadline:Date.now()+240000},{type:"result",protocol:"atoms-team/2",taskId,team,result,assistantReply}];
  return route.fulfill({contentType:"application/x-ndjson",body:messages.map(m=>JSON.stringify(m)).join("\n")+"\n"});
}
