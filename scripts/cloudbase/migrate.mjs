// node --import tsx --use-env-proxy scripts/cloudbase/migrate.mjs --credentials ... --env ... [--apply]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { builtinExampleFromHtml, EXAMPLE_STATE } from '../../src/lib/builtin-example.ts';
import { managementArgs, managementSql, sqlLiteral } from './pg-management.mjs';
const args = managementArgs();
const sql = managementSql(args.credentials, args.envId);
const migration = readFileSync(new URL('../../db/migrations/001_account_projects.sql', import.meta.url), 'utf8');
const example = await builtinExampleFromHtml(readFileSync(new URL('../../public/examples/tip-calculator-v1.html', import.meta.url), 'utf8'));
// Template provenance has no synthetic task history, user identity or credentials.
const { id, updatedAt, ...document } = example;
void id; void updatedAt;
document.result.generatedAt = '2026-10-10T00:00:00.000Z';
const template = JSON.stringify(document), state = JSON.stringify(EXAMPLE_STATE);
const checksum = createHash('sha256').update(migration + template + state).digest('hex');
console.log(JSON.stringify({ environment: args.envId, region: 'ap-shanghai', migration: '001_account_projects', checksum, apply: args.apply }));
try {
  if (!args.apply) {
    const result = await sql("SELECT to_regclass('atoms_private.migrations') IS NOT NULL AS installed");
    console.log(JSON.stringify({ ...result.summary, installed: result.rows[0]?.[0] }));
    if (result.rows[0]?.[0] === 'true' || result.rows[0]?.[0] === true) {
      const versions=await sql("SELECT id,checksum FROM atoms_private.migrations ORDER BY id");
      console.log(JSON.stringify({...versions.summary,migrations:versions.rows.map(([id,checksum])=>({id,checksum}))}));
    }
  } else {
    // One DO statement = one transaction. Checksum drift fails instead of silently
    // rewriting an installed schema. All DDL, seed and ledger commit together.
    const result = await sql(`DO $migration$ DECLARE old_checksum text; BEGIN
      PERFORM pg_advisory_xact_lock(670065);
      CREATE SCHEMA IF NOT EXISTS atoms_private;
      REVOKE ALL ON SCHEMA atoms_private FROM PUBLIC, anon, authenticated;
      CREATE TABLE IF NOT EXISTS atoms_private.migrations (id text PRIMARY KEY, checksum text NOT NULL);
      REVOKE ALL ON atoms_private.migrations FROM PUBLIC, anon, authenticated;
      SELECT checksum INTO old_checksum FROM atoms_private.migrations WHERE id = '001_account_projects';
      IF FOUND THEN
        IF old_checksum <> '${checksum}' THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
      ELSE
        EXECUTE $ddl$${migration}$ddl$;
        INSERT INTO atoms_private.templates VALUES ('tip-calculator:v1', ${sqlLiteral(template)}::jsonb, ${sqlLiteral(state)}::jsonb);
        INSERT INTO atoms_private.migrations VALUES ('001_account_projects', '${checksum}');
      END IF;
    END $migration$;`);
    console.log(JSON.stringify({ ...result.summary, applied: true }));
    const next = readFileSync(new URL('../../db/migrations/002_trusted_artifacts.sql', import.meta.url), 'utf8');
    const nextChecksum = createHash('sha256').update(next).digest('hex');
    const secret = process.env.ATOMS_ARTIFACT_SECRET;
    if (!/^[a-f\d]{64}$/i.test(secret ?? '')) throw new Error('ATOMS_ARTIFACT_SECRET is required for migration 002');
    const nextResult = await sql(`DO $migration$ DECLARE old_checksum text; BEGIN
      PERFORM pg_advisory_xact_lock(670065);
      SELECT checksum INTO old_checksum FROM atoms_private.migrations WHERE id = '002_trusted_artifacts';
      IF FOUND THEN
        IF old_checksum <> '${nextChecksum}' THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
        IF NOT EXISTS(SELECT 1 FROM atoms_private.artifact_key WHERE singleton AND secret=decode('${secret}','hex')) THEN RAISE EXCEPTION 'Artifact key mismatch'; END IF;
      ELSE
        EXECUTE $ddl$${next}$ddl$;
        INSERT INTO atoms_private.artifact_key VALUES(true,decode('${secret}','hex'));
        INSERT INTO atoms_private.migrations VALUES('002_trusted_artifacts','${nextChecksum}');
      END IF;
    END $migration$;`);
    console.log(JSON.stringify({...nextResult.summary, migration:'002_trusted_artifacts',checksum:nextChecksum,applied:true}));
    for (const name of ['003_artifact_receipt']) {
      const content=readFileSync(new URL(`../../db/migrations/${name}.sql`,import.meta.url),'utf8');
      const digest=createHash('sha256').update(content).digest('hex');
      const patched=await sql(`DO $migration$ DECLARE previous text; BEGIN
        PERFORM pg_advisory_xact_lock(670065);
        SELECT checksum INTO previous FROM atoms_private.migrations WHERE id='${name}';
        IF FOUND THEN IF previous<>'${digest}' THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
        ELSE EXECUTE $ddl$${content}$ddl$; INSERT INTO atoms_private.migrations VALUES('${name}','${digest}'); END IF;
      END $migration$;`);
      console.log(JSON.stringify({...patched.summary,migration:name,checksum:digest,applied:true}));
    }
  }
} catch (error) { console.error(JSON.stringify({ failed: true, ...error.summary })); process.exitCode = 1; }
