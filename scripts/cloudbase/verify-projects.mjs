// Isolated real PG transaction/RLS tests with SIMULATED JWT claims + SQL roles.
// This is explicitly not email/JWT gateway acceptance. No auth config is changed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { managementArgs, managementSql, sqlLiteral } from './pg-management.mjs';
const args = managementArgs(), sql = managementSql(args.credentials, args.envId);
const owner = `atoms-67-fixture-${randomUUID()}`, other = `atoms-67-fixture-${randomUUID()}`;
const op = randomUUID(), save = randomUUID();
const reports = [];
async function step(label, statement) {
  const result = await sql(statement); reports.push({ label, ...result.summary });
  console.log(JSON.stringify(reports.at(-1))); return result;
}
function asUser(user, statement, role = 'authenticated') {
  const claims = sqlLiteral(JSON.stringify({ sub: user, role }));
  return `DO $test$ DECLARE receipt jsonb; original jsonb; changed jsonb; BEGIN
    PERFORM set_config('request.jwt.claims', ${claims}, true);
    SET LOCAL ROLE ${role};
    ${statement}
  END $test$;`;
}
function check(expression, message) { return `IF (${expression}) IS NOT TRUE THEN RAISE EXCEPTION '${message}'; END IF;`; }
function rejects(statement, state) { return `BEGIN ${statement}; RAISE EXCEPTION 'expected rejection ${state}'; EXCEPTION WHEN SQLSTATE '${state}' THEN NULL; END;`; }
let projectId;
try {
  await step('copy as simulated authenticated role', asUser(owner, `receipt := public.atoms_copy_example('${op}'); ${check("receipt->'version'->>'data' = '1'", 'bad receipt')}`));
  const row = await step('inspect only fixture identity', `SELECT id FROM public.atoms_projects WHERE owner_id = ${sqlLiteral(owner)}`);
  assert.equal(row.rows.length, 1); projectId = row.rows[0][0]; assert.match(projectId, /^[\da-f-]{36}$/);
  await step('replay copy after committed response lost; no duplicate', asUser(owner, `receipt := public.atoms_copy_example('${op}'); ${check(`receipt->>'projectId' = '${projectId}'`, 'duplicate copy')} ${check('jsonb_array_length(public.atoms_list_projects()) = 1', 'duplicate list')}`));
  await step('direct write denied and cross-account rows hidden by RLS', asUser(other, `${check(`NOT EXISTS(SELECT 1 FROM public.atoms_projects WHERE id = '${projectId}')`, 'rls leak')}
    ${rejects(`PERFORM public.atoms_get_project('${projectId}')`, 'PT404')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 1, 1, '{"bill":999}'::jsonb)`, 'PT404')}
    ${rejects(`UPDATE public.atoms_projects SET state = '{}'::jsonb WHERE id = '${projectId}'`, '42501')}
    ${rejects('PERFORM * FROM atoms_private.operations', '42501')}`));
  await step('normal data commit and stale version rejection', asUser(owner, `
    original := public.atoms_get_project('${projectId}');
    receipt := public.atoms_save_data('${projectId}', '${save}', 1, 1, '{"bill":67,"preserved":"unknown"}'::jsonb);
    ${check("receipt->'version'->>'data' = '2'", 'version did not increment')}
    changed := public.atoms_get_project('${projectId}');
    ${check("changed->'state'->>'bill' = '67' AND changed->'project'->>'updatedAt' = receipt->>'updatedAt'", 'state and timestamp not atomic')}
    ${check("changed->'project'->'result' = original->'project'->'result'", 'data write changed code')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 1, 1, '{"bill":999}'::jsonb)`, 'PT409')}`));
  await step('lost save response replay wins over stale expected version', asUser(owner, `receipt := public.atoms_save_data('${projectId}', '${save}', 1, 1, '{"preserved":"unknown","bill":67}'::jsonb);
    ${check("receipt->'version'->>'data' = '2'", 'replay increments version')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${save}', 1, 1, '{"bill":68}'::jsonb)`, 'PT422')}`));
  const rolledBack = randomUUID();
  await step('forced transaction failure rolls back data and receipt together', asUser(owner, `
    BEGIN PERFORM public.atoms_save_data('${projectId}', '${rolledBack}', 1, 2, '{"bill":68}'::jsonb);
      RAISE EXCEPTION 'intentional test transaction rollback';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
    original := public.atoms_get_project('${projectId}'); ${check("original->'state'->>'bill' = '67' AND original->'version'->>'data' = '2'", 'failed transaction persisted')}
    receipt := public.atoms_save_data('${projectId}', '${rolledBack}', 1, 2, '{"bill":69}'::jsonb);
    ${check("receipt->'version'->>'data' = '3'", 'rollback left receipt')}`));
  await step('prepare isolated newer code version', `UPDATE public.atoms_projects SET code_version = 2 WHERE id = '${projectId}' AND owner_id = ${sqlLiteral(owner)}`);
  await step('old running code rejected for reads and writes', asUser(owner, `
    ${rejects(`PERFORM public.atoms_get_data('${projectId}', 1)`, 'PT409')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 1, 3, '{}'::jsonb)`, 'PT409')}`));
  await step('ordinary users cannot bypass versioned RPC with direct writes', asUser(owner, `${rejects(`UPDATE public.atoms_projects SET state = '{}'::jsonb WHERE id = '${projectId}'`, '42501')}`));
  const contenders = await Promise.allSettled([70, 71].map(bill => sql(asUser(owner, `
    PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 2, 3, '{"bill":${bill}}'::jsonb);
    PERFORM pg_sleep(0.15);`))));
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter(result => result.status === 'rejected').length, 1);
  const rejected = contenders.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.summary.sqlState, 'PT409');
  console.log(JSON.stringify({label: 'concurrent same-version writes: one commit, one conflict', results: contenders.map(result => result.status === 'fulfilled' ? result.value.summary : result.reason.summary)}));
  await step('concurrent winner visible; saved null remains valid JSON data', asUser(owner, `
    original := public.atoms_get_project('${projectId}');
    ${check("original->'version'->>'data' = '4' AND (original->'state'->>'bill') IN ('70','71')", 'concurrent result wrong')}
    receipt := public.atoms_save_data('${projectId}', '${randomUUID()}', 2, 4, NULL);
    original := public.atoms_get_data('${projectId}', 2);
    ${check("original->'state' = 'null'::jsonb AND original->>'hasData' = 'true'", 'null state lost')}`));
  await step('prepare isolated restricted project', `UPDATE public.atoms_projects SET document = jsonb_set(document, '{previewPolicy}', '{"status":"allowed","dataMode":"trial","adoption":"blocked"}'::jsonb) WHERE id = '${projectId}' AND owner_id = ${sqlLiteral(owner)}`);
  await step('restricted code cannot read/write formal data and retains restrictions', asUser(owner, `
    original := public.atoms_get_project('${projectId}');
    ${check("original->'project'->'previewPolicy'->>'dataMode' = 'trial' AND original->>'hasData' = 'false'", 'restriction lost')}
    ${rejects(`PERFORM public.atoms_get_data('${projectId}', 2)`, 'PT403')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 2, 5, '{}'::jsonb)`, 'PT403')}`));
  await step('anonymous denied even when function owner is privileged', `DO $test$ BEGIN
    PERFORM set_config('request.jwt.claims', '{"sub":"fake","role":"anon"}', true);
    ${rejects(`PERFORM public.atoms_get_project('${projectId}')`, 'PT401')}
    ${rejects(`PERFORM public.atoms_copy_example('${randomUUID()}')`, 'PT401')}
    ${rejects(`PERFORM public.atoms_list_projects()`, 'PT401')}
    ${rejects(`PERFORM public.atoms_get_data('${projectId}', 2)`, 'PT401')}
    ${rejects(`PERFORM public.atoms_save_data('${projectId}', '${randomUUID()}', 2, 3, '{}'::jsonb)`, 'PT401')}
  END $test$;`);
  console.log(JSON.stringify({ passed: reports.length, identity: 'management SQL, simulated authenticated role and JWT claims; no real email/JWT gateway' }));
} catch (error) { console.error(JSON.stringify({ failed: true, ...error.summary, assertion: error instanceof assert.AssertionError ? error.message : undefined })); process.exitCode = 1; }
finally {
  await step('cleanup only this run fixture rows and receipts', `DO $cleanup$ BEGIN
    DELETE FROM atoms_private.operations WHERE owner_id IN (${sqlLiteral(owner)}, ${sqlLiteral(other)});
    DELETE FROM public.atoms_projects WHERE owner_id IN (${sqlLiteral(owner)}, ${sqlLiteral(other)});
  END $cleanup$;`);
  const clean = await step('verify fixture cleanup', `SELECT count(*) FROM public.atoms_projects WHERE owner_id IN (${sqlLiteral(owner)}, ${sqlLiteral(other)})`);
  assert.equal(clean.rows[0][0], '0');
}
