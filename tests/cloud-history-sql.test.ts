// Runs the installed migration SQL on PostgreSQL/WASM. Claims, template and
// artifacts are synthetic. This is not CloudBase/JWT or concurrent-session evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { CloudProject, CommitReceipt, ProjectHistory, HistorySnapshot } from "../src/lib/cloud-projects/contract";
const lit=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const key='a'.repeat(64),owner='history-owner',other='history-other';
const policy={status:'allowed',reasons:[],dataMode:'formal',adoption:'allowed',review:'clean'};
const html='<!doctype html><html><head></head><body>V1</body></html>';
const result={html,model:'synthetic',durationMs:0,generatedAt:'2026-10-01T00:00:00.000Z'};
const record=(taskId:string)=>({taskId,startedAt:result.generatedAt,assistantReply:'fixture',events:[]});
const first=(extra:object={})=>{const taskId=randomUUID();return {v:1,kind:'artifact',ownerId:owner,projectId:randomUUID(),taskId,expected:null,requirement:'synthetic history',result,policy,initialGeneration:record(taskId),generations:[],...extra};};
const signed=(name:string,value:object,op?:string)=>{const payload=JSON.stringify(value),signature=createHmac('sha256',Buffer.from(key,'hex')).update(payload).digest('hex');return `public.atoms_${name}(${op?lit(op)+',':''}${lit(payload)},${lit(signature)})`;};
const claim=(a:ReturnType<typeof first>)=>signed('claim_task',{...a,kind:'start'});
const commit=(a:object,op=randomUUID())=>signed('commit_artifact',a,op);

test("installed history SQL preserves paired snapshots, trusted adoption and transaction rollback",async t=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims',true)::jsonb->>'sub' $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims',true)::jsonb->>'role' $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated;`);
 const migrate=async(name:string)=>db.exec(readFileSync(new URL('../db/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await migrate('001_account_projects');await migrate('002_trusted_artifacts');await migrate('003_artifact_receipt');
 await db.exec(`INSERT INTO atoms_private.artifact_key VALUES(true,decode('${key}','hex'));
 INSERT INTO atoms_private.templates VALUES('tip-calculator:v1',${lit(JSON.stringify({title:'example',requirement:'example',result,exampleSource:{kind:'builtin-example'}}))}::jsonb,'{"count":10}');`);
 async function rpc<T>(expr:string,user=owner):Promise<T>{
  return db.transaction(async tx=>{
   await tx.query(`SELECT set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:user,role:'authenticated'})]);
   await tx.exec('SET LOCAL ROLE authenticated');
   const r=await tx.query<{value:T}>(`SELECT ${expr} AS value`);await tx.exec('RESET ROLE');return r.rows[0].value;
  });
 }
 const get=(id:string)=>rpc<CloudProject>(`public.atoms_get_project('${id}')`);
 const list=(id:string,user=owner)=>rpc<ProjectHistory>(`public.atoms_list_history('${id}')`,user);
 const snap=(id:string,sid:string,user=owner)=>rpc<HistorySnapshot>(`public.atoms_get_snapshot('${id}','${sid}')`,user);
 const data=(id:string,c:number,d:number,count:number,op=randomUUID())=>rpc<CommitReceipt>(`public.atoms_save_data('${id}','${op}',${c},${d},'${JSON.stringify({count})}')`);
 const adopt=(a:object,op=randomUUID())=>rpc<CommitReceipt>(commit(a,op));
 const existing=first();await rpc(claim(existing));await adopt(existing);await data(existing.projectId,1,1,41);
 const restricted=first({policy:{...policy,dataMode:'trial',review:'unavailable'}});await rpc(claim(restricted));await adopt(restricted);
 await migrate('004_project_history');await migrate('005_history_restore');
 try {
 await t.test('pre-feature formal baseline is real and timestamp is explicitly unknown; restricted artifacts have no history',async()=>{
  const h=await list(existing.projectId);assert.equal(h.entries.length,1);assert.equal(h.entries[0].origin,'baseline');assert.equal(h.entries[0].dataSavedAt,null);
  assert.notEqual(h.entries[0].pairedAt,result.generatedAt);assert.deepEqual((await snap(existing.projectId,h.currentId!)).state,{count:41});
  assert.equal((await list(restricted.projectId)).entries.length,0);
 });
 const a=first();await rpc(claim(a));await adopt(a);
 await t.test('initial formal, example copy and explicit activation establish distinct genuine baselines',async()=>{
  let h=await list(a.projectId);assert.equal(h.entries[0].origin,'initial');assert.equal(h.entries[0].hasData,false);assert.equal((await snap(a.projectId,h.currentId!)).hasData,false);
  const op=randomUUID(),copy=await rpc<CommitReceipt>(`public.atoms_copy_example('${op}')`);await rpc(`public.atoms_copy_example('${op}')`);
  h=await list(copy.projectId);assert.equal(h.entries.length,1);assert.equal(h.entries[0].origin,'example');assert.ok(h.entries[0].dataSavedAt);assert.deepEqual((await snap(copy.projectId,h.currentId!)).state,{count:10});
  await rpc(`public.atoms_activate_project('${restricted.projectId}','${randomUUID()}',1,1)`);
  h=await list(restricted.projectId);assert.equal(h.entries.length,1);assert.equal(h.entries[0].origin,'activated');
  const draft=first({policy:{...policy,dataMode:'trial',adoption:'blocked'}});await rpc(claim(draft));await adopt(draft);assert.equal((await list(draft.projectId)).entries.length,0);
 });
 await data(a.projectId,1,1,10);await data(a.projectId,1,2,100);
 const taskId=randomUUID();const b={...a,taskId,expected:{code:1,data:3},baseHash:hash(html),initialGeneration:undefined,result:{...result,html:html.replace('V1','V2')},generations:[{...record(taskId),projectId:a.projectId,requirement:'change V2',outcome:'complete'}]};
 await rpc(signed('claim_task',{...b,kind:'start'}));
 const op=randomUUID();
 await t.test('capacity rejection after snapshot insertion rolls back adoption, snapshot sealing and task receipt together',async()=>{
  const before=await get(a.projectId),historyBefore=await list(a.projectId);
  await db.exec(`CREATE FUNCTION atoms_private.reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE SQLSTATE '53100' USING MESSAGE='controlled capacity rejection'; END $$;
  CREATE TRIGGER fixture_capacity AFTER INSERT ON atoms_private.history FOR EACH ROW EXECUTE FUNCTION atoms_private.reject_fixture();`);
  await assert.rejects(adopt(b,op),(e:unknown)=>{assert.equal((e as {code:string}).code,'53100');return true;});
  assert.deepEqual(await get(a.projectId),before);assert.deepEqual(await list(a.projectId),historyBefore);
  await db.exec('DROP TRIGGER fixture_capacity ON atoms_private.history; DROP FUNCTION atoms_private.reject_fixture();');
 });
 await t.test('adoption pairs V1 with its last 100 records, keeps official data and deduplicates response replay',async()=>{
  const receipt=await adopt(b,op);assert.deepEqual(await adopt(b,op),receipt);assert.deepEqual(await adopt(b),receipt);
  const h=await list(a.projectId);assert.equal(h.entries.length,2);assert.equal(h.entries[0].status,'current');assert.equal(h.entries[1].nextSequence,2);
  assert.deepEqual((await get(a.projectId)).state,{count:100});assert.equal(h.entries[1].hasData,true);assert.ok(h.entries[1].dataSavedAt);
  assert.deepEqual((await snap(a.projectId,h.entries[1].id)).state,{count:100});
  await data(a.projectId,2,3,120);assert.deepEqual((await get(a.projectId)).state,{count:120});assert.deepEqual((await snap(a.projectId,h.entries[1].id)).state,{count:100});
 });
 await t.test('history is private; IDs cannot bypass ownership or read/replace private snapshot content',async()=>{
  const h=await list(a.projectId),sid=h.entries[1].id;
  for(const action of [list(a.projectId,other),snap(a.projectId,sid,other),snap(existing.projectId,sid)])await assert.rejects(action,(e:unknown)=>['PT404','PT410'].includes((e as {code:string}).code));
  await assert.rejects(rpc('count(*) FROM atoms_private.history'),(e:unknown)=>(e as {code:string}).code==='42501');
  await assert.rejects(adopt({...b,policy:{...policy,dataMode:'trial'}},op),(e:unknown)=>(e as {code:string}).code==='PT422');
 });
 await t.test('stale data/adoption conflicts cannot change paired state; equal code still gets a new stable history identity',async()=>{
  const before=await list(a.projectId);await assert.rejects(data(a.projectId,1,3,999),(e:unknown)=>(e as {code:string}).code==='PT409');
  const tid=randomUUID(),same={...b,taskId:tid,expected:{code:2,data:4},baseHash:hash(b.result.html),generations:[{...record(tid),projectId:a.projectId,requirement:'same code new period',outcome:'complete'}]};
  await rpc(signed('claim_task',{...same,kind:'start'}));await data(a.projectId,2,4,121);
  await assert.rejects(adopt(same),(e:unknown)=>(e as {code:string}).code==='PT409');assert.deepEqual(await list(a.projectId),{...before,version:{code:2,data:5}});
  const next={...same,taskId:randomUUID(),expected:{code:2,data:5}};await rpc(signed('claim_task',{...next,kind:'start'}));await adopt(next);
  const h=await list(a.projectId);assert.equal(h.entries.length,3);assert.equal(new Set(h.entries.map(e=>e.id)).size,3);assert.deepEqual((await snap(a.projectId,h.entries[1].id)).state,{count:121});
 });
 await t.test('late log append cannot change historical data time or create snapshots',async()=>{
  const before=await list(a.projectId),sid=before.entries[2].id,point=await snap(a.projectId,sid);
  await rpc(signed('append_events',{v:1,kind:'events',ownerId:owner,projectId:a.projectId,taskId:a.taskId,events:[{source:'server',sequence:12,at:new Date().toISOString(),taskId:a.taskId,stepId:'late',label:'late',status:'completed',detail:'fixture'}]},randomUUID()));
  assert.deepEqual(await list(a.projectId),before);assert.deepEqual(await snap(a.projectId,sid),point);
 });
 const change=async(id:string,action:string,target:string,op=randomUUID(),expected?:CloudProject,user=owner,apply=true)=>{
  const current=expected ?? await get(id);
  return rpc<{receipt:CommitReceipt|null;project?:CloudProject['project']}>(`public.atoms_change_history('${id}','${op}','${action}','${target}',${current.version.code},${current.version.data},${current.historyRevision ?? 0},${apply})`,user);
 };
 await t.test('restore and undo retain complete history while write versions and ledgers only advance',async()=>{
  const before=await get(a.projectId),historyBefore=await list(a.projectId),target=historyBefore.entries.at(-1)!;
  const tid=randomUUID(),stale={...b,taskId:tid,expected:before.version,baseHash:hash(before.project.result.html),generations:[{...record(tid),projectId:a.projectId,requirement:'must never reappear',outcome:'complete'}]};
  await rpc(signed('claim_task',{...stale,kind:'start'}));
  const oldDataOp=randomUUID();await data(a.projectId,before.version.code,before.version.data,122,oldDataOp);
  const saved=await get(a.projectId),op=randomUUID();
  const prepared=await change(a.projectId,'restore',target.id,op,saved,owner,false);assert.equal(prepared.project?.result.html,html);assert.equal(prepared.receipt,null);
  assert.deepEqual(await get(a.projectId),saved);
  const receipt=await change(a.projectId,'restore',target.id,op,saved);
  assert.deepEqual(await change(a.projectId,'restore',target.id,op,saved),receipt);
  const restored=await get(a.projectId);assert.deepEqual(restored.state,{count:100});assert.equal(restored.project.result.html,html);
  assert.equal(restored.project.modificationRecords?.length,0);assert.equal(restored.restore?.id,op);assert.equal(restored.restore?.sequence,1);
  assert.deepEqual(restored.version,{code:saved.version.code+1,data:saved.version.data+1});
  assert.equal((await list(a.projectId)).entries.length,1);
  await assert.rejects(snap(a.projectId,historyBefore.entries[0].id),(e:unknown)=>(e as {code:string}).code==='PT410');
  await assert.rejects(change(a.projectId,'clear',target.id),(e:unknown)=>(e as {code:string}).code==='PT423');
  await assert.rejects(change(a.projectId,'undo',op,randomUUID(),restored,other),(e:unknown)=>(e as {code:string}).code==='PT404');
  await assert.rejects(rpc(signed('append_events',{v:1,kind:'events',ownerId:owner,projectId:a.projectId,taskId:b.taskId,events:[]},randomUUID())),(e:unknown)=>(e as {code:string}).code==='PT404');
  await data(a.projectId,restored.version.code,restored.version.data,999);assert.equal((await get(a.projectId)).restore?.id,op);
  const toUndo=await get(a.projectId),undoOp=randomUUID();const undoReceipt=await change(a.projectId,'undo',op,undoOp,toUndo);
  assert.deepEqual(await change(a.projectId,'undo',op,undoOp,toUndo),undoReceipt);
  const undone=await get(a.projectId);assert.deepEqual(undone.state,saved.state);assert.deepEqual(undone.project,{...saved.project,updatedAt:undone.project.updatedAt});assert.equal(undone.restore,null);
  assert.deepEqual((await list(a.projectId)).entries,historyBefore.entries);
  assert.deepEqual(undone.version,{code:toUndo.version.code+1,data:toUndo.version.data+1});
  await assert.rejects(adopt(stale),(e:unknown)=>(e as {code:string}).code==='PT409');
  await assert.rejects(data(a.projectId,saved.version.code,saved.version.data,888),(e:unknown)=>(e as {code:string}).code==='PT409');
  await data(a.projectId,before.version.code,before.version.data,122,oldDataOp);await adopt(b);
  assert.deepEqual(await get(a.projectId),undone); // old receipts are acknowledgement only
  await assert.rejects(change(a.projectId,'undo',op),(e:unknown)=>(e as {code:string}).code==='PT412');
 });
 await t.test('controlled storage abort rolls back backup replacement, restore and undo; retries keep the same operation',async()=>{
  const before=await get(a.projectId),historyBefore=await list(a.projectId),target=historyBefore.entries[1];const op=randomUUID();
  await db.exec(`CREATE FUNCTION atoms_private.reject_restore_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE SQLSTATE '53100' USING MESSAGE='controlled capacity rejection'; END $$;
  CREATE TRIGGER fixture_restore AFTER UPDATE ON public.atoms_projects FOR EACH ROW EXECUTE FUNCTION atoms_private.reject_restore_fixture();`);
  await assert.rejects(change(a.projectId,'restore',target.id,op,before),(e:unknown)=>(e as {code:string}).code==='53100');
  assert.deepEqual(await get(a.projectId),before);assert.deepEqual(await list(a.projectId),historyBefore);
  await db.exec('DROP TRIGGER fixture_restore ON public.atoms_projects;');
  await change(a.projectId,'restore',target.id,op,before);
  const restored=await get(a.projectId),h=await list(a.projectId);assert.equal(h.entries[1].protectedReason,'undo');
  await assert.rejects(change(a.projectId,'clear',h.entries[1].id),(e:unknown)=>(e as {code:string}).code==='PT423');
  await db.exec('CREATE TRIGGER fixture_restore AFTER UPDATE ON public.atoms_projects FOR EACH ROW EXECUTE FUNCTION atoms_private.reject_restore_fixture();');
  await assert.rejects(change(a.projectId,'restore',h.entries[1].id),(e:unknown)=>(e as {code:string}).code==='53100');
  await assert.rejects(change(a.projectId,'undo',op),(e:unknown)=>(e as {code:string}).code==='53100');
  assert.deepEqual(await get(a.projectId),restored);assert.deepEqual(await list(a.projectId),h);
  await db.exec('DROP TRIGGER fixture_restore ON public.atoms_projects; DROP FUNCTION atoms_private.reject_restore_fixture();');
  const nextOp=randomUUID();await change(a.projectId,'restore',h.entries[1].id,nextOp);
  assert.equal((await get(a.projectId)).restore?.id,nextOp);
  await assert.rejects(change(a.projectId,'undo',op),(e:unknown)=>(e as {code:string}).code==='PT412');
  await change(a.projectId,'undo',nextOp);assert.equal((await get(a.projectId)).project.result.html,restored.project.result.html);assert.equal((await get(a.projectId)).restore,null);
 });
 await t.test('adoption ends undo only on success; manual cleanup preserves conversation and is idempotent/private',async()=>{
  const points=await list(a.projectId);await change(a.projectId,'restore',points.entries.at(-1)!.id);
  let current=await get(a.projectId);const tid=randomUUID();const next={...b,taskId:tid,expected:current.version,baseHash:hash(current.project.result.html),generations:[{...record(tid),projectId:a.projectId,requirement:'new future',outcome:'complete'}]};
  await rpc(signed('claim_task',{...next,kind:'start'}));
  await db.exec(`CREATE FUNCTION atoms_private.fail_adopt_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE SQLSTATE '53100' USING MESSAGE='controlled reject'; END $$;
  CREATE TRIGGER fixture_adopt AFTER INSERT ON atoms_private.history FOR EACH ROW EXECUTE FUNCTION atoms_private.fail_adopt_fixture();`);
  await assert.rejects(adopt(next),(e:unknown)=>(e as {code:string}).code==='53100');assert.deepEqual(await get(a.projectId),current);
  await db.exec('DROP TRIGGER fixture_adopt ON atoms_private.history; DROP FUNCTION atoms_private.fail_adopt_fixture();');
  await adopt(next);current=await get(a.projectId);assert.equal(current.restore,null);
  const history=await list(a.projectId),target=history.entries[1];assert.equal(target.protectedReason,null);
  for(const action of ['restore','clear'])await assert.rejects(change(a.projectId,action,target.id,randomUUID(),current,other),(e:unknown)=>(e as {code:string}).code==='PT404');
  const op=randomUUID();const receipt=await change(a.projectId,'clear',target.id,op,current);assert.deepEqual(await change(a.projectId,'clear',target.id,op,current),receipt);
  const after=await get(a.projectId);assert.deepEqual(after.project.modificationRecords,current.project.modificationRecords);assert.deepEqual(after.version,current.version);assert.equal(after.historyRevision,current.historyRevision!+1);
  assert.equal((await list(a.projectId)).entries[1].status,'cleared');
  await assert.rejects(snap(a.projectId,target.id),(e:unknown)=>(e as {code:string}).code==='PT410');
  await assert.rejects(change(a.projectId,'restore',target.id),(e:unknown)=>(e as {code:string}).code==='PT410');
  await assert.rejects(change(a.projectId,'restore',target.id,randomUUID(),current),(e:unknown)=>(e as {code:string}).code==='PT409');
 });
 } finally {await db.close();}
});
