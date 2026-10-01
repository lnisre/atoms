// Run from repository root with: node --import tsx tests/team/live-cross-app.ts
// Default is a zero-network manifest. --execute requires prior human authorization.
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { syntheticRequirement, readingChanges, acceptanceScenarios, type AppKind } from './cross-app-scenarios';
import { crossAppWorkflow } from './cross-app-workflow';
import { repairWorkflow } from './repair-workflow';
import { hash } from './independent-check';

async function main() {
  const repair = process.argv.includes('--repair');
  const kind: AppKind = process.argv.includes('--todo') ? 'todo' : 'reading';
  const manifest = { provider: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', kind,
    requirement: syntheticRequirement(kind), changes: kind === 'reading' ? readingChanges : [],
    inputBoundary: 'Only these synthetic requests, generated HTML, role artifacts and platform prompts; no real business records or repository files',
    controlledModificationDefect: repair, taskCount: repair ? 1 : kind === 'reading' ? 3 : 1, perTask: { deadlineMs: 240000, modelRequests: 20, engineerArtifacts: 2 },
    independentPlanHashes: [false, ...(kind === 'reading' ? [true] : [])].map(rated => hash(JSON.stringify(acceptanceScenarios(kind, rated)))) };
  if (!process.argv.includes('--execute')) { console.log(JSON.stringify(manifest, null, 2)); return; }
  const base = process.env.TEST_BASE_URL, destination = process.env.TEAM_EVIDENCE_DIR;
  if (!base || !destination) throw new Error('Explicit TEST_BASE_URL and new TEAM_EVIDENCE_DIR required');
  const target = new URL(base);
  if (target.username || target.password || target.search || target.hash || !['http:', 'https:'].includes(target.protocol)) throw new Error('Use a clean target URL without credentials');
  const out = resolve(destination);
  if (existsSync(out)) throw new Error('Refusing to overwrite earlier evidence');
  mkdirSync(out, { recursive: true });
  const evidence = (label: string, value: unknown) => writeFileSync(`${out}/${label}.json`, JSON.stringify(value, null, 2));
  const baseline = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    target: base, deploymentId: process.env.TEAM_DEPLOYMENT_ID ?? null };
  const sourceFiles = execFileSync('git', ['ls-files', 'src', 'runtime/team', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'Dockerfile.vercel'], { encoding: 'utf8' }).trim().split('\n');
  evidence('manifest', { ...manifest, ...baseline, sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(file, 'utf8'))])) });
  // Avoid inheriting model/deployment secrets into the browser process.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []));
  const browser = await chromium.launch({ channel: 'chrome', env });
  const context = await browser.newContext();
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) await context.route(url => url.origin === target.origin, route => route.continue({ headers: {
    ...route.request().headers(), 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET!, 'x-vercel-set-bypass-cookie': 'true',
  } }));
  const events: Record<string, unknown>[] = [], started = Date.now();
  context.on('page', page => page.on('websocket', ws => ws.on('framereceived', event => {
    const m = JSON.parse(String(event.payload));
    // Strict field whitelist: no session capability, ticket, cookies, request headers.
    if (m.type === 'session') events.push({ type: m.type, taskId: m.taskId, projectId: m.projectId, deadline: m.deadline });
    else if (['delivery', 'call', 'step', 'result', 'error'].includes(m.type)) {
      const { type, taskId, delivery, call, event: step, result, team, error, outcome, assistantReply } = m;
      events.push({ type, taskId, delivery, call, step, result, team, error, outcome, assistantReply });
    }
    evidence('events', events);
  })));
  let success = false, failure: string | undefined;
  try { if (repair) await repairWorkflow(context, base, evidence); else await crossAppWorkflow(context, base, kind, evidence); success = true; }
  catch (error) { failure = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
  finally {
    const calls = new Map<string, Record<string, unknown>>();
    for (const event of events) if (event.type === 'call') { const call = event.call as Record<string, unknown>; calls.set(`${event.taskId}:${call.call}`, { taskId: event.taskId, ...call }); }
    evidence('summary', { kind: 'real provider, isolated synthetic project, independent developer acceptance', ...baseline, success, failure,
      elapsedMs: Date.now() - started, calls: [...calls.values()], callsWithoutUsage: [...calls.values()].filter(c => !c.usage).length });
    await browser.close();
  }
  console.log(JSON.stringify({ success, failure, evidence: out }));
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
