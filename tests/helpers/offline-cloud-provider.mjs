// Explicit test-only Auth/PG provider seam for the REAL gateway/Next/Python lane.
// Load with NODE_OPTIONS=--import=... only under synthetic-auth + offline model.
// No browser generation/socket interception and no production credentials.
import { createHmac } from 'node:crypto';
if(process.env.CLOUDBASE_ENV_ID!=='synthetic-auth'||process.env.DEEPSEEK_API_KEY!=='offline-test-placeholder')throw new Error('Offline provider requires synthetic environment');
const original=globalThis.fetch,rows=new Map(),receipts=new Map(),claims=new Set();
const profile={sub:'synthetic-account',email:'synthetic@example.invalid',email_verified:true};
const response=value=>Promise.resolve(Response.json(value));
const receipt=projectId=>({projectId,version:rows.get(projectId)?.version??{code:1,data:1},updatedAt:new Date().toISOString()});
globalThis.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname!=='synthetic-auth.api.tcloudbasegateway.com')return original(input,options);
 const body=options?.body?JSON.parse(String(options.body)):{};
 if(url.pathname.startsWith('/auth/v1/')){
  if(url.pathname.endsWith('/verification'))return response({verification_id:'offline-challenge',is_user:true,expires_in:600});
  if(url.pathname.endsWith('/verification/verify'))return response({verification_token:'offline-proof'});
  if(url.pathname.endsWith('/signin'))return response({access_token:'offline-access',expires_in:7200});
  if(url.pathname.endsWith('/user/me'))return response(profile);
  throw new Error('Unexpected offline Auth operation');
 }
 const name=url.pathname.split('/').at(-1).replace(/^atoms_/,'');
 let payload;
 if(body.p_payload){
  if(createHmac('sha256',Buffer.from(process.env.ATOMS_ARTIFACT_SECRET,'hex')).update(body.p_payload).digest('hex')!==body.p_signature)throw new Error('Invalid offline signature');
  payload=JSON.parse(body.p_payload);if(payload.ownerId!==profile.sub)throw new Error('Foreign offline owner');
 }
 if(name==='list_projects')return response([...rows.values()].map(row=>row.project));
 if(name==='claim_task'){
  if(claims.has(payload.taskId))return Response.json({code:'PT409'},{status:409});
  claims.add(payload.taskId);return response(receipt(payload.projectId));
 }
 if(name==='commit_artifact'){
  if(receipts.has(body.p_operation_id))return response(receipts.get(body.p_operation_id));
  const old=rows.get(payload.projectId);
  if(payload.expected&&JSON.stringify(payload.expected)!==JSON.stringify(old?.version))return Response.json({code:'PT409'},{status:409});
  const project={...(old?.project??{id:payload.projectId,title:payload.requirement.slice(0,48),requirement:payload.requirement,initialGeneration:payload.initialGeneration}),updatedAt:new Date().toISOString(),result:payload.result,previewPolicy:payload.policy,
   modificationRecords:[...(old?.project.modificationRecords??[]),...(payload.expected?[{id:body.p_operation_id,adoptedAt:new Date().toISOString(),requests:payload.generations.map(g=>g.requirement),summary:'Offline adoption',generations:payload.generations}]:[])]};
  rows.set(payload.projectId,{project,version:{code:(old?.version.code??0)+1,data:old?.version.data??1},state:old?.state??null,hasData:old?.hasData??false});
  const saved=receipt(payload.projectId);receipts.set(body.p_operation_id,saved);return response(saved);
 }
 if(name==='append_events'){
  const row=rows.get(payload.projectId),record=row.project.modificationRecords?.flatMap(r=>r.generations??[]).find(g=>g.taskId===payload.taskId)??row.project.initialGeneration;
  for(const event of payload.events)if(!record.events.some(e=>e.source===event.source&&e.sequence===event.sequence))record.events.push(event);
  return response(receipt(payload.projectId));
 }
 const row=rows.get(body.p_project_id);
 if(!row)return Response.json({code:'PT404'},{status:404});
 if(name==='get_project')return response(row);
 if(name==='get_data')return response({state:row.state,hasData:row.hasData,version:row.version});
 if(name==='save_data'){row.state=body.p_state;row.hasData=true;row.version.data++;return response(receipt(body.p_project_id));}
 throw new Error('Unexpected offline RPC '+name);
};
