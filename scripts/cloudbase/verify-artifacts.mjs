// Real PG transactions with synthetic claims/role and signed synthetic artifacts.
// No email, model, real Auth identity or management-as-user acceptance is claimed.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { signProof } from '../../src/lib/cloud-projects/artifacts.ts';
import { managementArgs, managementSql, sqlLiteral as lit } from './pg-management.mjs';
const args=managementArgs(), sql=managementSql(args.credentials,args.envId);
const owner='atoms-68-fixture-'+randomUUID(), other='atoms-68-fixture-'+randomUUID();
const pid=randomUUID(), tid=randomUUID(), op=randomUUID();
const hash=s=>createHash('sha256').update(s).digest('hex');
const html='<!doctype html><html><head></head><body>synthetic first</body></html>';
const result={html,model:'synthetic-no-model',durationMs:1,generatedAt:new Date().toISOString()};
const policy={status:'allowed',reasons:[],dataMode:'formal',adoption:'allowed',review:'clean'};
const record=id=>({taskId:id,startedAt:result.generatedAt,assistantReply:'synthetic fixture',events:[]});
const first={v:1,kind:'artifact',ownerId:owner,projectId:pid,taskId:tid,expected:null,requirement:'synthetic account transaction',result,policy,initialGeneration:record(tid),generations:[]};
const signed=(fn,b,id)=>{const p=signProof(b);return `public.atoms_${fn}(${id ? lit(id)+',' : ''}${lit(p.payload)},${lit(p.signature)})`;};
const claim=b=>signed('claim_task',{v:1,kind:'start',ownerId:b.ownerId,projectId:b.projectId,taskId:b.taskId,expected:b.expected,baseHash:b.baseHash});
const commit=(b,id=randomUUID())=>signed('commit_artifact',b,id);
const check=(expr,msg)=>`IF (${expr}) IS NOT TRUE THEN RAISE EXCEPTION '${msg}'; END IF;`;
const rejects=(expr,state)=>`BEGIN PERFORM ${expr}; RAISE EXCEPTION 'expected ${state}'; EXCEPTION WHEN SQLSTATE '${state}' THEN NULL; END;`;
const asUser=(body,user=owner,role='authenticated')=>`DO $test$ DECLARE receipt jsonb; old jsonb; current jsonb; BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify({sub:user,role}))},true); SET LOCAL ROLE ${role}; ${body} END $test$;`;
let passed=0;
async function step(label,statement) {const r=await sql(statement);console.log(JSON.stringify({label,...r.summary}));passed++;return r;}
try {
 await step('single task claim and duplicate paid start rejected',asUser(`PERFORM ${claim(first)}; ${rejects(claim(first),'PT409')}`));
 await step('first artifact commits once; changed payload and another owner rejected',asUser(`receipt:=${commit(first,op)}; ${check("receipt->'version'->>'code'='1'",'code version')}
  PERFORM ${commit(first,op)}; PERFORM ${commit(first)};
  ${check('jsonb_array_length(public.atoms_list_projects())=1','duplicate project')}
  ${rejects(commit({...first,requirement:'changed'},op),'PT422')}`));
 await step('other ordinary role cannot replay artifact or read signing key',asUser(`${rejects(commit(first),'PT403')}
  BEGIN PERFORM * FROM atoms_private.artifact_key; RAISE EXCEPTION 'key exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`,other));
 const forged=signProof(first);forged.payload=forged.payload.replace('synthetic first','forged');
 await step('direct ordinary RPC cannot forge HTML/policy without proof',asUser(rejects(`public.atoms_commit_artifact('${randomUUID()}',${lit(forged.payload)},${lit(forged.signature)})`,'PT403')));
 await step('formal data before candidate remains independent',asUser(`PERFORM public.atoms_save_data('${pid}','${randomUUID()}',1,1,'{"kept":68}');`));
 const modify=(name)=>({...first,taskId:randomUUID(),expected:{code:1,data:2},baseHash:hash(html),result:{...result,html:html.replace('first',name)},initialGeneration:undefined,generations:[]});
 const a=modify('candidate A'),b=modify('candidate B');
 a.generations=[{...record(a.taskId),projectId:pid,requirement:'change A',outcome:'complete'}];b.generations=[{...record(b.taskId),projectId:pid,requirement:'change B',outcome:'complete'}];
 await step('both devices can start from current code; stale input rejected at start',asUser(`PERFORM ${claim(a)}; PERFORM ${claim(b)}; ${rejects(claim({...a,taskId:randomUUID(),expected:{code:1,data:1}}),'PT409')}`));
 const adoption=randomUUID();
 await step('adoption rollback leaves original code/data/records, then atomic commit',asUser(`
 BEGIN PERFORM ${commit(a,adoption)}; RAISE EXCEPTION 'forced rollback'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
 current:=public.atoms_get_project('${pid}'); ${check("current->'version'->>'code'='1' AND jsonb_array_length(current->'project'->'modificationRecords')=0",'rollback partial')}
 receipt:=${commit(a,adoption)}; current:=public.atoms_get_project('${pid}');
 ${check("current->'version'->>'code'='2' AND current->'state'->>'kept'='68' AND jsonb_array_length(current->'project'->'modificationRecords')=1",'adoption partial')}
 PERFORM ${commit(a,adoption)}; PERFORM ${commit(a)};
 ${rejects(commit(b),'PT409')}
 ${rejects(`public.atoms_save_data('${pid}','${randomUUID()}',1,2,'{}')`,'PT409')}`));
 const logop=randomUUID(),events={v:1,kind:'events',ownerId:owner,projectId:pid,taskId:tid,events:[{taskId:tid,source:'server',sequence:1,stepId:'fixture',label:'synthetic append',status:'completed',at:result.generatedAt,detail:'synthetic'}]};
 await step('log append/replay after adoption and data does not revert either',asUser(`PERFORM public.atoms_save_data('${pid}','${randomUUID()}',2,2,'{"kept":69}');
 PERFORM ${signed('append_events',events,logop)}; PERFORM ${signed('append_events',events,logop)}; PERFORM ${signed('append_events',events,randomUUID())};
 current:=public.atoms_get_project('${pid}'); ${check("current->'version'->>'code'='2' AND current->'version'->>'data'='3' AND current->'state'->>'kept'='69' AND jsonb_array_length(current->'project'->'initialGeneration'->'events')=1",'log reverted project')}`));
 const c={...a,taskId:randomUUID(),expected:{code:2,data:3},baseHash:hash(a.result.html),result:{...result,html:html.replace('first','concurrent C')}};
 const d={...c,taskId:randomUUID(),result:{...result,html:html.replace('first','concurrent D')}};
 for(const item of [c,d])item.generations=[{...record(item.taskId),projectId:pid,requirement:'concurrent change',outcome:'complete'}];
 await step('claim simultaneous adoption contenders',asUser(`PERFORM ${claim(c)}; PERFORM ${claim(d)};`));
 const contenders=await Promise.allSettled([c,d].map(item=>sql(asUser(`PERFORM ${commit(item)}; PERFORM pg_sleep(0.15);`))));
 assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(contenders.filter(r=>r.status==='rejected').length,1);
 assert.equal(contenders.find(r=>r.status==='rejected').reason.summary.sqlState,'PT409');
 console.log(JSON.stringify({label:'simultaneous code adoptions: one commit, one conflict',results:contenders.map(r=>r.status==='fulfilled'?r.value.summary:r.reason.summary)}));
 await step('concurrent adoption preserves formal data and appends one record',asUser(`current:=public.atoms_get_project('${pid}'); ${check("current->'version'->>'code'='3' AND current->'state'->>'kept'='69' AND jsonb_array_length(current->'project'->'modificationRecords')=2",'concurrent adoption wrong')}`));
 for(const adoptionAllowed of [true,false]) {
  const draft={...first,projectId:randomUUID(),taskId:randomUUID(),policy:{...policy,dataMode:'trial',review:'unavailable',adoption:adoptionAllowed?'allowed':'blocked'}};draft.initialGeneration=record(draft.taskId);
  await step('restricted artifact saved from first delivery; activation '+adoptionAllowed,asUser(`PERFORM ${claim(draft)}; PERFORM ${commit(draft)};
   current:=public.atoms_get_project('${draft.projectId}'); ${check("current->'project' ? 'draftResult' AND current->>'hasData'='false'",'draft lost')}
   ${rejects(`public.atoms_get_data('${draft.projectId}',1)`,'PT403')}
   ${adoptionAllowed ? `PERFORM public.atoms_activate_project('${draft.projectId}','${randomUUID()}',1,1);` : rejects(`public.atoms_activate_project('${draft.projectId}','${randomUUID()}',1,1)`,'PT403')}`));
 }
 await step('anonymous claims rejected at every new public function',`DO $test$ BEGIN PERFORM set_config('request.jwt.claims','{"role":"anon","sub":"fake"}',true);
 ${rejects(claim(first),'PT401')}${rejects(commit(first),'PT401')}${rejects(signed('append_events',events,randomUUID()),'PT401')}${rejects(`public.atoms_activate_project('${pid}','${randomUUID()}',2,3)`,'PT401')} END $test$;`);
 console.log(JSON.stringify({passed,identity:'synthetic claims and authenticated SQL role, signed synthetic artifacts; not real email/JWT/model acceptance'}));
} catch(error) {console.error(JSON.stringify({failed:true,...error.summary,assertion:error instanceof assert.AssertionError?error.message:undefined}));process.exitCode=1;}
finally {
 await step('cleanup isolated projects operations and task claims',`DO $cleanup$ BEGIN DELETE FROM atoms_private.tasks WHERE owner_id=${lit(owner)}; DELETE FROM atoms_private.operations WHERE owner_id=${lit(owner)}; DELETE FROM public.atoms_projects WHERE owner_id=${lit(owner)}; END $cleanup$;`);
 const r=await step('verify cleanup',`SELECT (SELECT count(*) FROM public.atoms_projects WHERE owner_id=${lit(owner)})+(SELECT count(*) FROM atoms_private.tasks WHERE owner_id=${lit(owner)})+(SELECT count(*) FROM atoms_private.operations WHERE owner_id=${lit(owner)})`);assert.equal(r.rows[0][0],'0');
}
