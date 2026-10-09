#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const command = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8' }).trim();
const sha = data => createHash('sha256').update(data).digest('hex');
export function sourceIdentity() {
  const paths = command('git', ['ls-files', 'src', 'public', 'runtime/team', 'package.json', 'pnpm-lock.yaml', 'next.config.ts']).split('\n');
  return { commit: command('git', ['rev-parse', 'HEAD']), status: command('git', ['status', '--porcelain']),
    files: Object.fromEntries(paths.map(path => [path, sha(readFileSync(resolve(root, path)))])) };
}
export function listeners(port) {
  try { return command('lsof', ['-nP', '-t', '-iTCP:' + port, '-sTCP:LISTEN']).split('\n').map(Number); }
  catch (error) { if (error.status === 1) return []; throw error; }
}
export async function doctor({ url, pid, mode = 'dev' }) {
  assert.equal(process.versions.node.split('.')[0], '24', 'Use Node 24');
  assert(['dev', 'team'].includes(mode), 'mode must be dev or team');
  const target = new URL(url);
  assert(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname), 'Doctor only supports local HTTP; document remote identity separately');
  assert(target.port && target.pathname === '/' && !target.search && !target.username && !target.password, 'Use a plain local origin');
  assert(Number.isInteger(pid) && pid > 1, 'Supply the PID returned by your own launcher');
  process.kill(pid, 0);
  const cwd = command('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n'))?.slice(1);
  assert.equal(realpathSync(cwd), realpathSync(root), 'Server belongs to a different worktree');
  const rows = command('ps', ['-axo', 'pid=,ppid=']).split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([pid]);
  for (let changed = true; changed;) { changed = false; for (const [child, parent] of rows) if (owned.has(parent) && !owned.has(child)) { owned.add(child); changed = true; } }
  const ports = mode === 'team' ? [Number(target.port), Number(target.port) + 1] : [Number(target.port)];
  const ownership = Object.fromEntries(ports.map(port => {
    const ids = [...new Set(listeners(port))];
    assert(ids.length && ids.every(id => owned.has(id)), 'Port ' + port + ' is not owned by this instance');
    return [port, ids];
  }));
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Home did not return HTTP 200');
  assert((await response.text()).includes('Atoms'), 'Unexpected application');
  const asset = await fetch(new URL('/examples/tip-calculator-v1.html', target), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.equal(asset.status, 200, 'Example asset missing');
  const assetHash = sha(await asset.text());
  assert.equal(assetHash, sha(readFileSync(resolve(root, 'public/examples/tip-calculator-v1.html'))), 'Served asset differs from checkout');
  const buildFile = resolve(root, '.next/BUILD_ID');
  if (mode === 'team') assert(existsSync(buildFile), 'Build the standalone runtime first');
  return { status: 'passed', mode, url: target.origin, pid, ownership, worktree: root,
    node: process.version, next: JSON.parse(readFileSync(resolve(root, 'node_modules/next/package.json'))).version,
    playwright: JSON.parse(readFileSync(resolve(root, 'node_modules/@playwright/test/package.json'))).version,
    build: mode === 'dev' ? 'development; live checkout, not a production build' : readFileSync(buildFile, 'utf8').trim(),
    servedExampleHash: assetHash, source: sourceIdentity(),
    limits: mode === 'team' ? 'HTTP/port/build preflight only; Python, provider auth and native routing need the team checks in references/team.md' : 'UI/storage only; no team gateway or provider auth claim' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, pid, mode] = process.argv.slice(2);
  doctor({ url, pid: Number(pid), mode }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({ status: 'failed', error: error.message })); process.exitCode = 1;
  });
}
