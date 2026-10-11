import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {managementArgs,managementSql,sqlLiteral as lit} from './pg-management.mjs';
import {signProof} from '../../src/lib/cloud-projects/artifacts.ts';
const args=managementArgs();
if(args.namespace==='atoms')throw Error('Use an isolated acceptance namespace, never production');
const sql=statement=>managementSql(args.credentials,args.envId)(statement.replaceAll('atoms_h74_',args.namespace+'_'));
const owner='history74-'+randomUUID(),other='history74-'+randomUUID(),pid=randomUUID();
const runId=randomUUID(),rows=[];
const fn=n=>'public.atoms_h74_'+n;
const hash=s=>createHash('sha256').update(s).digest('hex');
const result=n=>({html:`<!doctype html><html><head></head><body>synthetic V${n}</body></html>`,model:'synthetic-no-model',durationMs:0,generatedAt:new Date().toISOString()});
const policy={status:'allowed',reasons:[],dataMode:'formal',adoption:'allowed',review:'clean'};
const artifact=(n,expected)=>{const taskId=randomUUID();return {v:1,kind:'artifact',ownerId:owner,projectId:pid,taskId,expected,requirement:'history isolation fixture',result:result(n),policy,...(expected?{baseHash:hash(result(n-1).html),generations:[{taskId,startedAt:new Date().toISOString(),assistantReply:'synthetic',events:[],projectId:pid,requirement:'request V'+n,outcome:'complete'}]}:{initialGeneration:{taskId,startedAt:new Date().toISOString(),assistantReply:'synthetic',events:[]},generations:[]})};};
const signed=(name,b,op)=>{const proof=signProof(b);return `${fn(name)}(${op?lit(op)+',':''}${lit(proof.payload)},${lit(proof.signature)})`;};
const claim=a=>signed('claim_task',{...a,kind:'start'}),commit=(a,op=randomUUID())=>signed('commit_artifact',a,op);
const get=`${fn('get_project')}('${pid}')`,list=`${fn('list_history')}('${pid}')`;
const data=(c,d,count,op=randomUUID())=>`${fn('save_data')}('${pid}','${op}',${c},${d},'{"count":${count}}')`;
const change=(action,target,op,c,d,h)=>`${fn('change_history')}('${pid}','${op}','${action}',${target},${c},${d},${h},true)`;
const target="(history->'entries'->-1->>'id')::uuid";
const check=(expr,label)=>`IF (${expr}) IS NOT TRUE THEN RAISE EXCEPTION '${label}'; END IF;`;
const reject=(expr,code)=>`BEGIN PERFORM ${expr}; RAISE EXCEPTION 'expected ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END;`;
const asUser=(body,user=owner)=>`DO $test$ DECLARE before_state jsonb; current_state jsonb; history jsonb; receipt jsonb; BEGIN PERFORM set_config('request.jwt.claims',${lit(JSON.stringify({sub:user,role:'authenticated'}))},true);SET LOCAL ROLE authenticated; ${body} END $test$;`;
async function step(label,statement){const r=await sql(statement);rows.push({label,...r.summary,outcome:'pass'});console.log(JSON.stringify(rows.at(-1)));return r;}
const a=artifact(1,null),b=artifact(2,{code:1,data:3}),c=artifact(3,{code:2,data:4});
let exit=0;
try{
 const installed=await step('read isolated migration checksums',`SELECT id,checksum FROM atoms_h74_private.migrations ORDER BY id`);
 for(const name of ['004_project_history','005_history_restore'])assert.equal(installed.rows.find(r=>r[0]===name)?.[1],hash(readFileSync(new URL('../../db/migrations/'+name+'.sql',import.meta.url),'utf8')));
 await step('trusted V1 10→100, V2 120, V3 with formal history',asUser(`PERFORM ${claim(a)};PERFORM ${commit(a)};PERFORM ${data(1,1,10)};PERFORM ${data(1,2,100)};PERFORM ${claim(b)};PERFORM ${commit(b)};PERFORM ${data(2,3,120)};PERFORM ${claim(c)};PERFORM ${commit(c)};
 history:=${list};${check("jsonb_array_length(history->'entries')=3",'history count')}`));
 const stale=artifact(4,{code:3,data:4});await step('claim pre-restore candidate for later replay rejection',asUser(`PERFORM ${claim(stale)};`));
 const op=randomUUID(),undo=randomUUID();
 await step('transaction abort after necessary restore writes keeps code data history undo and operation receipt unchanged',asUser(`before_state:=${get};history:=${list};BEGIN PERFORM ${change('restore',target,op,3,4,0)};RAISE SQLSTATE '53100' USING MESSAGE='controlled storage rejection';EXCEPTION WHEN SQLSTATE '53100' THEN NULL;END;${check(`${get}=before_state`,'partial restore')}${check(`${list}=history`,'partial history')}`));
 await step('restore commits paired100 and truncated source context, duplicate response returns original receipt',asUser(`history:=${list};receipt:=${change('restore',target,op,3,4,0)};${check(`${change('restore',target,op,3,4,0)}=receipt`,'replay mismatch')}current_state:=${get};${check("current_state->'state'->>'count'='100' AND current_state->'project'->'result'->>'html'="+lit(a.result.html)+" AND jsonb_array_length(current_state->'project'->'modificationRecords')=0 AND current_state->'restore'->>'id'='"+op+"'",'restore contents')}`));
 await step('independent request sees entire restored state and protection, old save and proof fail',asUser(`current_state:=${get};history:=${list};${check("current_state->'version'='{\"code\":4,\"data\":5}'::jsonb AND jsonb_array_length(history->'entries')=1",'not fully committed')}${reject(data(3,4,999),'PT409')}${reject(commit(stale),'PT409')}${reject(change('clear',target,randomUUID(),4,5,1),'PT423')}`));
 await step('other ordinary SQL role cannot read restore undo or clean another owner',asUser(`${reject(get,'PT404')}${reject(list,'PT404')}${reject(change('undo',lit(op)+'::uuid',randomUUID(),4,5,1),'PT404')}${reject(change('restore',lit(randomUUID())+'::uuid',randomUUID(),4,5,1),'PT404')}${reject(change('clear',lit(randomUUID())+'::uuid',randomUUID(),4,5,1),'PT404')}`,other));
 await step('saving data retains undo; full undo restores original future while counters advance; retry deduplicates',asUser(`PERFORM ${data(4,5,999)};PERFORM ${change('undo',lit(op)+'::uuid',undo,4,6,1)};PERFORM ${change('undo',lit(op)+'::uuid',undo,4,6,1)};current_state:=${get};history:=${list};${check("current_state->'state'->>'count'='120' AND current_state->'version'='{\"code\":5,\"data\":7}'::jsonb AND current_state->'restore'='null'::jsonb AND jsonb_array_length(history->'entries')=3 AND jsonb_array_length(current_state->'project'->'modificationRecords')=2",'undo incomplete')}${reject(commit(stale),'PT409')}${reject(data(3,4,777),'PT409')}`));
 const r1=randomUUID();
 await step('restore V2 protects retained V1 dependency and keeps backup on failed second restore',asUser(`history:=${list};PERFORM ${change('restore',"(history->'entries'->1->>'id')::uuid",r1,5,7,2)};before_state:=${get};history:=${list};${reject(change('clear',target,randomUUID(),6,8,3),'PT423')}BEGIN PERFORM ${change('restore',target,randomUUID(),6,8,3)};RAISE SQLSTATE '53100';EXCEPTION WHEN SQLSTATE '53100' THEN NULL;END;${check(`${get}=before_state`,'backup replaced on failure')}`));
 const racingRestore=asUser(`history:=${list};PERFORM ${change('restore',target,randomUUID(),6,8,3)};PERFORM pg_sleep(0.3);`);
 const racingSave=asUser(`PERFORM ${data(6,8,121)};PERFORM pg_sleep(0.3);`);
 const race=await Promise.allSettled([sql(racingRestore),sql(racingSave)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected')?.reason.summary.sqlState,'PT409');
 rows.push({label:'actual independent SQL requests racing restore and data save: exactly one winner',status:'pass',results:race.map(r=>r.status==='fulfilled'?r.value.summary:r.reason.summary)});console.log(JSON.stringify(rows.at(-1)));
 // Fresh state drives the undo target/versions after either legitimate winner.
 await step('separate session observes complete race winner; undo remains usable',asUser(`current_state:=${get};history:=${list};${check("current_state->'restore' IS NOT NULL AND (current_state->'version'->>'data')::int=9",'race state')}
 PERFORM ${fn('change_history')}('${pid}','${randomUUID()}','undo',(current_state->'restore'->>'id')::uuid,(current_state->'version'->>'code')::int,(current_state->'version'->>'data')::int,(current_state->>'historyRevision')::int,true);`));
 await step('cleanup transaction failure retains snapshot; successful cleanup preserves document and duplicate operation is stable',asUser(`before_state:=${get};history:=${list};
 BEGIN PERFORM ${fn('change_history')}('${pid}','${randomUUID()}','clear',${target},(before_state->'version'->>'code')::int,(before_state->'version'->>'data')::int,(before_state->>'historyRevision')::int,true);RAISE SQLSTATE '53100';EXCEPTION WHEN SQLSTATE '53100' THEN NULL;END;${check(`${get}=before_state AND ${list}=history`,'partial cleanup')}
 receipt:=${fn('change_history')}('${pid}','${runId}','clear',${target},(before_state->'version'->>'code')::int,(before_state->'version'->>'data')::int,(before_state->>'historyRevision')::int,true);
 ${check(`${fn('change_history')}('${pid}','${runId}','clear',${target},(before_state->'version'->>'code')::int,(before_state->'version'->>'data')::int,(before_state->>'historyRevision')::int,true)=receipt`,'clear duplicate')}
 current_state:=${get};${check("current_state->'project'->'modificationRecords'=before_state->'project'->'modificationRecords' AND current_state->'version'=before_state->'version'",'clear changed conversation')}
 ${reject(`${fn('get_snapshot')}('${pid}',${target})`,'PT410')}`));
}catch(e){exit=1;rows.push({status:'fail',summary:e.summary,message:e instanceof assert.AssertionError?e.message:'controlled SQL check failed'});console.log(JSON.stringify(rows.at(-1)));}
finally{
 await step('remove only this synthetic SQL owner and its ledgers',`DO $cleanup$ BEGIN DELETE FROM atoms_h74_private.tasks WHERE owner_id=${lit(owner)};DELETE FROM atoms_h74_private.operations WHERE owner_id=${lit(owner)};DELETE FROM public.atoms_h74_projects WHERE owner_id=${lit(owner)};END $cleanup$;`);
 const evidence=process.env.HISTORY_EVIDENCE_FILE;
 if(evidence)writeFileSync(evidence,JSON.stringify({namespace:args.namespace,identity:'synthetic claims with SET LOCAL ROLE authenticated; not real JWT',faults:'transaction sub-block abort with controlled SQLSTATE 53100, independent concurrent ExecutePGSql requests',modelCalls:0,results:rows},null,2));process.exitCode=exit;
}
