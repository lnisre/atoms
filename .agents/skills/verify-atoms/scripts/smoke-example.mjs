#!/usr/bin/env node
// Real UI + IndexedDB + full Chrome restart. No clock or application-state injection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, openSync, closeSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { doctor, root, listeners, sourceIdentity } from './doctor.mjs';

const [destination, requestedPort = '3210'] = process.argv.slice(2);
assert(destination, 'Usage: node .agents/skills/verify-atoms/scripts/smoke-example.mjs NEW_EVIDENCE_DIR [PORT]');
assert.equal(process.versions.node.split('.')[0], '24', 'Use Node 24');
const port = Number(requestedPort);
assert(Number.isInteger(port) && port > 1024 && port < 65535, 'Choose an unprivileged port');
const out = resolve(destination);
assert(!existsSync(out), 'Use a NEW evidence directory; earlier attempts survive');
mkdirSync(out, { recursive: true });
const record = (name, value) => writeFileSync(join(out, name + '.json'), JSON.stringify(value, null, 2));
const profile = mkdtempSync(join(tmpdir(), 'atoms-verify-profile-'));
const base = 'http://127.0.0.1:' + port;
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
let server, context, page, logFd, groupId, spawnError, interrupted = false;
let success = false, failure, browserStarted = false;
const steps = [], requests = [], consoleErrors = [], cleanup = {};
const plannedCoverage = ['home example', 'real start/pause and IndexedDB save', 'paused refresh', 'full browser restart and home reopen', 'zero API requests'];
const coverage = [];
const step = (action, result) => { steps.push({ at: new Date().toISOString(), action, result }); record('actions', steps); };
const stopSignal = () => { interrupted = true; };
process.on('SIGINT', stopSignal); process.on('SIGTERM', stopSignal);
const ensureActive = () => { assert(!interrupted, 'Run interrupted; cleanup required'); };
async function snapshot() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('atoms-projects', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'applicationData'], 'readonly');
      const projects = tx.objectStore('projects').getAll(), data = tx.objectStore('applicationData').getAll();
      tx.oncomplete = () => resolve({ projects: projects.result, data: data.result });
      tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  });
}
const frame = () => page.frameLocator('iframe');
async function launchBrowser(round) {
  ensureActive();
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true,
    baseURL: base, viewport: { width: 1440, height: 900 }, env });
  browserStarted = true;
  context.setDefaultTimeout(15000);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push({ round, method: route.request().method(), path: url.origin === base ? url.pathname : 'external-origin-blocked' });
    if (url.origin !== base || url.pathname.startsWith('/api/')) return route.abort('blockedbyclient');
    return route.continue();
  });
  context.on('page', p => p.on('pageerror', error => consoleErrors.push(error.stack ?? error.message)));
  page = await context.newPage();
  step('launch Chrome', { round, persistentProfile: 'isolated temporary profile', browser: context.browser()?.version() });
}
async function closeBrowser(round) {
  if (!context) return;
  const current = context;
  try { await current.tracing.stop({ path: join(out, 'trace-' + round + '.zip') }); }
  finally { await current.close(); context = undefined; }
  step('close complete persistent browser', { round });
}
async function openCard() {
  await page.goto('/');
  const card = page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /示例 · 专注番茄钟/ });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(frame().locator('#toggleBtn')).toBeEnabled();
}
try {
  assert.equal(listeners(port).length, 0, 'Port already occupied; do not drive it');
  assert(!existsSync(join(root, '.next/dev/lock')), 'An existing dev session may own this worktree; inspect before continuing');
  const driverHashes = Object.fromEntries(['doctor.mjs', 'smoke-example.mjs'].map(name => [name, createHash('sha256').update(readFileSync(join(root, '.agents/skills/verify-atoms/scripts', name))).digest('hex')]));
  record('manifest', { driverHashes, startedAt: new Date().toISOString(), base, mode: 'dev UI/storage smoke, no model', source: sourceIdentity() });
  logFd = openSync(join(out, 'server.log'), 'wx');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root, detached: true, env: { ...env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', logFd, logFd],
  });
  groupId = server.pid;
  server.on('error', error => { spawnError = error; });
  record('instance', { pid: groupId, processGroup: groupId, worktree: root, base, profile });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    ensureActive();
    if (spawnError) throw spawnError;
    assert(server.exitCode === null, 'Next exited; inspect server.log');
    try { const response = await fetch(base, { signal: AbortSignal.timeout(2000) }); if (response.ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert(ready, 'Next did not become ready');
  record('doctor', await doctor({ url: base, pid: groupId }));
  step('launch and doctor', 'passed');
  await launchBrowser(1);
  await openCard();
  await expect(frame().locator('#timeDisplay')).toHaveText('25:00');
  const initial = await snapshot();
  assert.equal(initial.projects.length, 1);
  assert.equal(initial.data.filter(row => row.state !== undefined).length, 0);
  const id = new URL(page.url()).searchParams.get('project');
  assert.equal(initial.projects[0].id, id);
  assert(!initial.projects[0].initialGeneration, 'Example must not invent model history');
  record('initial', initial);
  await page.screenshot({ path: join(out, 'initial.png') });
  step('open example through home card', { projectId: id, timer: '25:00', modelHistory: false });
  coverage.push('home example');
  await frame().getByRole('button', { name: '开始', exact: true }).click();
  await expect(frame().locator('#status')).toHaveText('已保存');
  await expect(frame().locator('#timeDisplay')).not.toHaveText('25:00', { timeout: 10000 });
  step('start and observe real elapsed time', await frame().locator('#timeDisplay').innerText());
  await frame().getByRole('button', { name: '暂停', exact: true }).click();
  await expect(frame().getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  await expect(frame().locator('#status')).toHaveText('已保存');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  const saved = await snapshot(), row = saved.data.find(row => row.projectId === id);
  assert(row && row.state.running === false && row.state.remaining > 0 && row.state.remaining < 1500);
  const time = await frame().locator('#timeDisplay').innerText();
  assert.equal(time, String(Math.floor(row.state.remaining / 60)).padStart(2, '0') + ':' + String(row.state.remaining % 60).padStart(2, '0'));
  record('saved', saved);
  step('pause; UI and committed IndexedDB agree', { timer: time, state: row.state });
  coverage.push('real start/pause and IndexedDB save');
  await page.screenshot({ path: join(out, 'saved.png') });
  await page.reload();
  await expect(frame().locator('#timeDisplay')).toHaveText(time);
  await expect(frame().getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  assert.deepEqual(await snapshot(), saved);
  step('refresh project deep link', 'same code and committed paused data');
  coverage.push('paused refresh');
  await closeBrowser(1);
  ensureActive();
  await launchBrowser(2);
  await openCard();
  await expect(page).toHaveURL(new RegExp('project=' + id));
  await expect(frame().locator('#timeDisplay')).toHaveText(time);
  await expect(frame().getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  const reopened = await snapshot();
  assert.deepEqual(reopened, saved);
  record('reopened', reopened);
  await page.screenshot({ path: join(out, 'reopened.png') });
  coverage.push('full browser restart and home reopen');
  assert.equal(requests.filter(r => r.path.startsWith('/api/')).length, 0, 'Unexpected API request');
  coverage.push('zero API requests');
  assert.equal(consoleErrors.length, 0, 'Unexpected page error');
  ensureActive();
  step('full Chrome restart; home card reopen', { timer: time, sameProjectCodeAndData: true, apiRequests: 0 });
  success = true;
} catch (error) {
  failure = error.stack;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {});
    writeFileSync(join(out, 'failure-page.txt'), await page.locator('body').innerText().catch(() => 'unavailable'));
  }
} finally {
  try { await closeBrowser('final'); cleanup.browserClosed = browserStarted ? true : 'not-started'; }
  catch (error) { cleanup.browserClosed = false; cleanup.browserError = error.message; success = false; }
  if (groupId) {
    const alive = () => { try { process.kill(-groupId, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
    try {
      if (alive()) process.kill(-groupId, 'SIGTERM');
      for (let i = 0; i < 50 && alive(); i++) await delay(100);
      if (alive()) { process.kill(-groupId, 'SIGKILL'); await delay(300); }
      cleanup.serverStopped = !alive();
      cleanup.portReleased = listeners(port).length === 0;
      if (!cleanup.serverStopped || !cleanup.portReleased) success = false;
    } catch (error) { cleanup.serverError = error.message; success = false; }
  } else { cleanup.serverStopped = 'not-started'; }
  if (logFd !== undefined) closeSync(logFd);
  if (cleanup.browserClosed === true || !browserStarted) { rmSync(profile, { recursive: true, force: true }); cleanup.profileRemoved = !existsSync(profile); }
  record('network', { requests, apiRequests: requests.filter(r => r.path.startsWith('/api/')).length, consoleErrors });
  record('cleanup', cleanup);
  const artifacts = ['manifest.json', 'actions.json', 'doctor.json', 'saved.json', 'reopened.json', 'reopened.png', 'trace-1.zip', 'trace-final.zip'];
  const retained = Object.fromEntries(artifacts.map(name => [name, existsSync(join(out, name)) ? createHash('sha256').update(readFileSync(join(out, name))).digest('hex') : null]));
  if (success && Object.values(retained).some(value => value === null)) { success = false; failure = 'Expected evidence missing after cleanup'; }
  record('summary', { success, failure, cleanup, retained, evidence: out,
    plannedCoverage, coverage,
    unverified: [...plannedCoverage.filter(check => !coverage.includes(check)),
      'running/expired timer restoration', 'fault injection', 'team and real model', 'other feature maps', 'production build/deployment'] });
  console.log(JSON.stringify({ success, failure, evidence: out, cleanup }));
  if (!success) process.exitCode = 1;
}
