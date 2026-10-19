import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, validateManifest, readBlob } from './release-manifest.mjs';
import { verifyDeployment, project, team, productionOrigin } from './vercel-manifest.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const [command, directory, ref] = process.argv.slice(2);
if (!['plan', 'create', 'stage', 'status', 'verify'].includes(command) || !directory || (command === 'plan' && !ref)) {
  console.error('Usage: node --use-env-proxy scripts/vercel-release.mjs plan NEW_DIR COMMIT | create DIR | stage DIR | status DIR | verify DIR');
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
  if (command === 'create' || command === 'stage') {
    const isolated=command==='stage';
    const runtimeEnv=isolated ? Object.fromEntries(['CLOUDBASE_ENV_ID','ATOMS_AUTH_SECRET','ATOMS_ARTIFACT_SECRET','QA_TOOL_SIGNING_KEY'].map(key=>{const value=process.env[key];if(!value)throw new Error('Missing isolated runtime configuration: '+key);return [key,value];})) : undefined;
    if (existsSync(resolve(dir, 'attempt.json'))) throw new Error('Attempt already recorded; inspect Vercel before retrying (a timeout may still have created a deployment)');
    const files = manifest.files.map(entry => {
      const content = readBlob(repo, entry.blob);
      if ([token,...Object.values(runtimeEnv??{})].filter(v=>v.length>30).some(v=>content.includes(Buffer.from(v)))) throw new Error('Credential found in release source');
      return { file: entry.file, data: content.toString('base64'), encoding: 'base64' };
    });
    const previous = await request('/v13/deployments/v0-test0-nine.vercel.app');
    save('attempt.json', { isolated, startedAt: new Date().toISOString(), previous: summary(previous), sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest });
    const deployment = await request('/v13/deployments', 'POST', { name: 'v0-test0', project, target: 'production', ...(isolated?{autoAssignCustomDomains:false,env:runtimeEnv}:{}), files, projectSettings: { framework: 'container', nodeVersion: '24.x' }, meta: { sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, sourceRepo: 'lnisre/atoms', purpose: isolated?'atoms-isolated-container-acceptance':'atoms-container-release' } });
    save('deployment.json', summary(deployment));
    if(isolated && (deployment.target!=='production' || (await request('/v13/deployments/v0-test0-nine.vercel.app')).id!==previous.id))throw new Error('Isolated deployment changed production identity');
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
  const result = verifyDeployment(manifest, deployment, alias, tree, builds, load('attempt.json').isolated ? load('attempt.json').previous.id : undefined);
  const isolated=load('attempt.json').isolated;
  const probeOrigin=isolated?`https://${deployment.url}`:productionOrigin;
  const protection=isolated?await request(`/v9/projects/${project}`):undefined;
  const bypass=protection?Object.keys(protection.protectionBypass??{})[0]:undefined;
  // Anonymous release probe must be rejected before issuing a ticket or starting a model task.
  // Authenticated negotiation and user lifecycle acceptance remain separate.
  const taskId = randomUUID();
  const response = await fetch(`${probeOrigin}/api/generate`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Origin: probeOrigin, ...(bypass?{'x-vercel-protection-bypass':bypass}:{}), 'X-Atoms-Protocol': 'atoms-team/3', 'X-Atoms-Task-Id': taskId }, body: JSON.stringify({ projectId: randomUUID(), requirement: '发布入口零模型检查：创建一个计数器。' }), signal: AbortSignal.timeout(30_000) });
  const entry = await response.json();
  if (response.status !== 401 || entry.code !== 'unauthenticated' || entry.ticket) throw new Error(`Anonymous team entry was not rejected: HTTP ${response.status}`);
  // Recheck alias after probing so a concurrent release cannot pass unnoticed.
  if ((await request('/v13/deployments/v0-test0-nine.vercel.app')).id !== (isolated?load('attempt.json').previous.id:id)) throw new Error('Production alias changed during verification');
  save('verification.json', { ...result, anonymousTeamEntry: { status: response.status, code: entry.code, modelRequests: 0 }, authenticatedTeamEntry: 'pending-authorized-user-check', businessAcceptance: 'pending-independent-real-model-check' });
  console.log(JSON.stringify(load('verification.json')));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
