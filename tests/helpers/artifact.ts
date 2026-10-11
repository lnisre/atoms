import { createHash } from "node:crypto";
import type { Artifact, ArtifactProof } from "../../src/lib/cloud-projects/artifact-contract";
import type { TeamRecord, Delivery } from "../../src/lib/team/contract";
import type { ProjectVersion } from "../../src/lib/cloud-projects/contract";
import { signProof } from "../../src/lib/cloud-projects/artifacts";
export function syntheticArtifact(ownerId: string, projectId: string, taskId: string, html: string, baseHtml?: string, expected?: ProjectVersion, previous: Artifact["generations"] = []) {
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex"),codeHash=hash(html);
  const review={kind:"code-review" as const,schemaVersion:1 as const,resolutions:[],taskId,codeHash,approved:true,summary:"SYNTHETIC REVIEW; not model evidence",issues:[]};
  const assign=(to:string):Delivery=>({role:"Mike",content:JSON.stringify({command:"assign",to})});
  const deliveries:Delivery[]=[assign("Requirements"),{role:"Requirements",content:JSON.stringify({requirements:[{id:"synthetic",description:"synthetic"}]})},assign("Engineer"),{role:"Engineer",content:JSON.stringify({codeHash,iteration:1})},assign("Reviewer"),{role:"Reviewer",content:JSON.stringify(review)},{role:"Mike",content:JSON.stringify({command:"finish"})}];
  const team:TeamRecord={protocol:"atoms-team/3",taskId,projectId,codeHash,review,outcome:"passed",deliveries,...(baseHtml?{baseCodeHash:hash(baseHtml),baseDataIssues:[]}:{}),calls:deliveries.map((d,i)=>({call:i+1,actor:d.role,requestedModel:"synthetic",status:"completed"}))};
  const result={html,model:"synthetic-no-provider",durationMs:1,generatedAt:new Date().toISOString()};
  const record={taskId,startedAt:result.generatedAt,assistantReply:"Synthetic assistant explanation",events:[],team};
  const artifact:Artifact={v:1,kind:"artifact",ownerId,projectId,taskId,requirement:"Synthetic counter",expected:expected??null,...(baseHtml?{baseHash:hash(baseHtml)}:{}),result,policy:{status:"allowed",reasons:[],dataMode:"formal",adoption:"allowed",review:"clean"},...(expected?{}:{initialGeneration:record}),generations:expected?[...previous,{...record,projectId,requirement:"Synthetic change",outcome:"complete"}]:[]};
  const proof:ArtifactProof=signProof(artifact);
  const wire=[{type:"session",protocol:"atoms-team/3",taskId,projectId,token:"synthetic-fixture",deadline:Date.now()+240000},{type:"result",protocol:"atoms-team/3",taskId,team,result,assistantReply:record.assistantReply,proof}].map(m=>JSON.stringify(m)).join("\n")+"\n";
  return {artifact,proof,wire,team};
}
