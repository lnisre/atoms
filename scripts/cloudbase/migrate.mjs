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
  }
} catch (error) { console.error(JSON.stringify({ failed: true, ...error.summary })); process.exitCode = 1; }
