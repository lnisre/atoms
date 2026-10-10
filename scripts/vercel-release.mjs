import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, validateManifest, readBlob, verifyDeployment, project, team, productionOrigin } from './release-manifest.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const [command, directory, ref] = process.argv.slice(2);
if (!['plan', 'create', 'status', 'verify'].includes(command) || !directory || (command === 'plan' && !ref)) {
  console.error('Usage: node --use-env-proxy scripts/vercel-release.mjs plan NEW_DIR COMMIT | create DIR | status DIR | verify DIR');
  process.exit(1);
}
const dir = resolve(directory);
const save = (name, value) => writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n');
const load = name => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const summary = d => ({ id: d.id, url: d.url, target: d.target, readyState: d.readyState, projectId: d.projectId, sourceCommit: d.meta?.sourceCommit, sourceDigest: d.meta?.sourceDigest, errorCode: d.errorCode });

async function main() {
  if (command === 'plan') {
    const manifest = buildManifest(repo, ref);
    mkdirSync(dir); // Never overwrite another attempt's evidence.
    save('manifest.json', manifest);
    console.log(JSON.stringify({ sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, files: manifest.files.length, directory: dir }));
    return;
  }
  const manifest = validateManifest(repo, load('manifest.json'));
  const { VERCEL_TOKEN } = process.env.VERCEL_TOKEN ? process.env : parseEnv(readFileSync(process.env.ATOMS_VERCEL_TOKEN_FILE || resolve(repo, '.vercel_atoms_agent.token'), 'utf8'));
  if (!VERCEL_TOKEN?.trim() || /[\r\n]/.test(VERCEL_TOKEN)) throw new Error('Invalid Vercel credential format');
  const token = VERCEL_TOKEN.trim();
  async function request(path, method = 'GET', body) {
    const response = await fetch(`https://api.vercel.com${path}?teamId=${team}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Vercel ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  if (command === 'create') {
    if (existsSync(resolve(dir, 'attempt.json'))) throw new Error('Attempt already recorded; inspect Vercel before retrying (a timeout may still have created a deployment)');
    const files = manifest.files.map(entry => {
      const content = readBlob(repo, entry.blob);
      if (content.includes(Buffer.from(token))) throw new Error('Credential found in release source');
      return { file: entry.file, data: content.toString('base64'), encoding: 'base64' };
    });
    const previous = await request('/v13/deployments/v0-test0-nine.vercel.app');
    save('attempt.json', { startedAt: new Date().toISOString(), previous: summary(previous), sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest });
    const deployment = await request('/v13/deployments', 'POST', { name: 'v0-test0', project, target: 'production', files, projectSettings: { framework: 'container', nodeVersion: '24.x' }, meta: { sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, sourceRepo: 'lnisre/atoms', purpose: 'atoms-container-release' } });
    save('deployment.json', summary(deployment));
    console.log(JSON.stringify(summary(deployment)));
    return;
  }
  const id = load('deployment.json').id;
  if (!/^dpl_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid deployment ID');
  const deployment = await request(`/v13/deployments/${id}`);
  const alias = await request('/v13/deployments/v0-test0-nine.vercel.app');
  save('status.json', { deployment: summary(deployment), alias: summary(alias) });
  if (command === 'status') {
    console.log(JSON.stringify({ deployment: summary(deployment), alias: summary(alias) }));
    return;
  }
  const tree = await request(`/v6/deployments/${id}/files`);
  const builds = await request(`/v1/deployments/${id}/builds`);
  const result = verifyDeployment(manifest, deployment, alias, tree, builds);
  // Negotiate only: do not consume the ticket or start a Python/model task.
  const taskId = randomUUID();
  const response = await fetch(`${productionOrigin}/api/generate`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Origin: productionOrigin, 'X-Atoms-Protocol': 'atoms-team/3', 'X-Atoms-Task-Id': taskId }, body: JSON.stringify({ projectId: randomUUID(), requirement: '发布入口零模型检查：创建一个计数器。' }), signal: AbortSignal.timeout(30_000) });
  const entry = await response.json();
  if (response.status !== 200 || entry.protocol !== 'atoms-team/3' || entry.transport !== 'websocket' || entry.taskId !== taskId || !entry.ticket?.signature) throw new Error(`Team gateway negotiation failed: HTTP ${response.status}`);
  // Recheck alias after probing so a concurrent release cannot pass unnoticed.
  if ((await request('/v13/deployments/v0-test0-nine.vercel.app')).id !== id) throw new Error('Production alias changed during verification');
  save('verification.json', { ...result, teamEntry: { status: response.status, protocol: entry.protocol, transport: entry.transport, modelRequests: 0 }, businessAcceptance: 'pending-independent-real-model-check' });
  console.log(JSON.stringify(load('verification.json')));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
