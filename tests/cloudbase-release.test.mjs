import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseApi } from '../scripts/cloudbase/release-api.mjs';
import { runtimeConfiguration, configurationFingerprint, configurationItems, validateTarget } from '../scripts/cloudbase/release-config.mjs';
import { stageRelease, verifyRelease } from '../scripts/cloudbase/release.mjs';
import { buildManifest } from '../scripts/release-manifest.mjs';
import { createSourcePackage, pushedImageDigest, immutableImage, digest } from '../scripts/cloudbase/release-source.mjs';

const target = { envId: 'synthetic-env', region: 'ap-shanghai', serverName: 'atoms-beta', productionServerName: 'atoms-production',
  origin: 'https://atoms-beta.invalid', cpu: 1, memory: 2, minInstances: 0, maxInstances: 1, dataMode: 'isolated', namespace: 'atoms_beta' };
const secret = 'SYNTHETIC_ONLY_'.padEnd(48, 'x');
const runtime = runtimeConfiguration(target, { DEEPSEEK_API_KEY: secret, ATOMS_AUTH_SECRET: 'a'.repeat(64),
  ATOMS_ARTIFACT_SECRET: 'b'.repeat(64), QA_TOOL_SIGNING_KEY: secret + 'c', CLOUDBASE_ENV_ID: target.envId,
  ATOMS_PROJECT_NAMESPACE: target.namespace, ATOMS_APP_ORIGIN: target.origin });
const credentials = { TENCENTCLOUD_SECRETID: 'SENSITIVE_ID', TENCENTCLOUD_SECRETKEY: 'SENSITIVE_KEY', CLOUDBASE_ENV_ID: target.envId };
const manifest = { commit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
const imageDigest = 'sha256:' + 'c'.repeat(64), image = 'ccr.ccs.tencentyun.com/synthetic/image:v1';
const fingerprint = configurationFingerprint(runtime);
const attempt = { fingerprintKey: fingerprint.key };
const health = { status: 'ready', nextReady: true, protocol: 'atoms-team/3', sourceCommit: manifest.commit,
  sourceDigest: manifest.sourceDigest, activeConnections: 0, stopping: false };
const source = { archiveSha256: digest(Buffer.from('synthetic archive')) };

test('target and runtime reject management/test credentials, implicit shared data, loose origins and unbounded resources', () => {
  for (const change of [{ serverName: target.productionServerName }, { origin: target.origin + '/anything' }, { maxInstances: 99 },
    { dataMode: 'existing-account-data' }, { namespace: 'atoms' }, { typo: true }]) assert.throws(() => validateTarget({ ...target, ...change }));
  const input = Object.fromEntries(Object.entries(runtime).filter(([key]) => key !== 'ATOMS_HOSTING'));
  for (const change of [{ TENCENTCLOUD_SECRETKEY: secret }, { ATOMS_AUTH_TEST_TRANSPORT: 'yes' },
    { ATOMS_APP_ORIGIN: 'https://other.invalid' }, { ATOMS_AUTH_SECRET: 'short' }]) assert.throws(() => runtimeConfiguration(target, { ...input, ...change }));
  assert.equal(configurationItems(target, runtime).find(item => item.Key === 'Port').IntValue, 3000);
  assert.doesNotMatch(JSON.stringify(fingerprint), /SYNTHETIC_ONLY/);
});

test('real API boundary signs official requests, refuses other scope/actions and suppresses raw errors and upload signatures', async () => {
  const requests = [];
  const api = releaseApi({ credentials, ...target, fetcher: async (url, options) => {
    requests.push({ url: String(url), action: options.headers['X-TC-Action'], body: options.body });
    assert.match(options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=/);
    return { ok: true, status: 200, json: async () => ({ Response: { RequestId: 'synthetic', Error: { Code: 'UnauthorizedOperation', Message: secret } } }) };
  } });
  await assert.rejects(api.call('tcbr', 'DeleteCloudRunServer', { EnvId: target.envId }), /outside/);
  await assert.rejects(api.call('tcbr', 'UpdateCloudRunServer', { EnvId: 'other-env' }), /outside/);
  await assert.rejects(api.upload({ UploadUrl: 'https://evil.invalid/?signature=' + secret }, Buffer.alloc(0)), /Untrusted/);
  await assert.rejects(api.call('tcbr', 'DescribeCloudRunServers', { EnvId: target.envId }), error => {
    assert.doesNotMatch(error.message, /SYNTHETIC_ONLY/); return error.code === 'UnauthorizedOperation';
  });
  assert.equal(requests.length, 1);
});

function fakeApi({ existing = false, mutationTimeout = false, altered = false, moving = false } = {}) {
  const calls = []; let details = 0;
  const scope = { EnvId: target.envId, ServerName: target.serverName };
  const detail = () => ({ BaseInfo: { ServerName: target.serverName, Status: 'normal', ServerType: 'container', DefaultDomainName: target.origin },
    ServerConfig: { ...scope, Cpu: 1, Mem: 2, MinNum: 0, MaxNum: 1, Port: 3000,
      OpenAccessTypes: ['PUBLIC'], EnvParams: JSON.stringify(altered ? { ...runtime, ATOMS_APP_ORIGIN: 'https://wrong.invalid' } : runtime) },
    OnlineVersionInfos: [{ VersionName: moving && ++details > 1 ? 'atoms-beta-003' : 'atoms-beta-002', ImageUrl: image, FlowRatio: '100' }] });
  return { calls, upload: async () => calls.push({ action: 'UPLOAD' }), call: async (service, action, params) => {
    calls.push({ service, action, params });
    if (action === 'DescribeBillingInfo') return { EnvBillingInfoList: [{ EnvId: target.envId, PackageId: 'baas_personal', EnableOverrun: false, Status: 'NORMAL' }] };
    if (action === 'DescribeCloudRunServers') return { Total: existing ? 1 : 0, ServerList: existing ? [{ ServerName: target.serverName }] : [] };
    if (action === 'DescribeCloudRunServerDetail') return detail();
    if (action === 'DescribeCloudRunDeployRecord') return { DeployRecords: [{ ImageUrl: image, Status: 'normal', BuildId: 123, FlowRatio: 100 }] };
    if (action === 'DescribeServerManageTask') return { IsExist: true, Task: { Id: 42, Status: 'finished' } };
    if (action === 'DescribeCloudRunBuildLog') return { Log: { Text: `v1: digest: ${imageDigest} size: 1234` } };
    if (action === 'DescribeCloudBaseBuildService') return { PackageName: 'synthetic-package', PackageVersion: 'v1', UploadUrl: 'secret-not-recorded' };
    if (action === 'CreateCloudRunServer' || action === 'UpdateCloudRunServer') {
      if (mutationTimeout) throw Error('transport timeout');
      return { RequestId: 'synthetic-request', TaskId: 42 };
    }
    throw Error('Unexpected action');
  } };
}

test('stage writes an owned attempt before official mutation, preserves secret-free evidence, and never repeats unknown outcomes', async () => {
  const saved = {}, api = fakeApi({ mutationTimeout: true });
  const options = { api, target, runtime, manifest, source, readArchive: () => Buffer.from('synthetic archive'),
    save: (name, data) => { assert.equal(saved[name], undefined); saved[name] = data; }, attemptExists: () => !!saved['attempt.json'] };
  await assert.rejects(stageRelease(options), /timeout/);
  assert.ok(saved['attempt.json']);
  const mutation = api.calls.find(value => value.action === 'CreateCloudRunServer');
  assert.equal(mutation.params.DeployInfo.DeployType, 'package');
  assert.equal(mutation.params.DeployInfo.ReleaseType, 'FULL');
  assert.equal(mutation.params.Items.find(item => item.Key === 'MaxNum').IntValue, 1);
  assert.doesNotMatch(JSON.stringify(saved), /SYNTHETIC_ONLY|secret-not-recorded/);
  await assert.rejects(stageRelease(options), /already recorded/);
  assert.equal(api.calls.filter(value => value.action === 'CreateCloudRunServer').length, 1);
  await assert.rejects(stageRelease({ ...options, api: fakeApi({ existing: true }), attemptExists: () => false }), /expectedVersion/);
});

test('verify binds actual resource config, source health, version and build manifest digest; unknown or moving state fails closed', async () => {
  const options = { target, runtime, manifest, source, attempt, health: { origin: target.origin, observedAt: new Date().toISOString(), body: health } };
  const result = await verifyRelease({ ...options, api: fakeApi() });
  assert.equal(result.image, 'ccr.ccs.tencentyun.com/synthetic/image@' + imageDigest);
  assert.equal(result.productAcceptance, 'pending-verify-atoms');
  assert.equal(result.wss600Seconds, 'pending-platform-evidence');
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_ONLY/);
  await assert.rejects(verifyRelease({ ...options, api: fakeApi({ altered: true }) }), /configuration mismatch/);
  await assert.rejects(verifyRelease({ ...options, api: fakeApi({ moving: true }) }), /changed during/);
  await assert.rejects(verifyRelease({ ...options, api: fakeApi(), health: { ...options.health, body: { ...health, sourceCommit: 'd'.repeat(40) } } }), /health mismatch/);
  await assert.rejects(verifyRelease({ ...options, api: fakeApi(), target: { ...target, origin: 'https://unbound.invalid' } }), /not bound/);
  await assert.rejects(verifyRelease({ ...options, api: fakeApi(), source: { image: immutableImage(image, imageDigest) } }), /immutable image identity/);
  const bootstrapRuntime = { ...runtime, ATOMS_APP_ORIGIN: 'https://unconfigured.invalid' };
  const bootstrapApi = fakeApi(); const originalCall = bootstrapApi.call;
  bootstrapApi.call = async (...args) => { const data = await originalCall(...args); if(args[1] === 'DescribeCloudRunServerDetail')data.ServerConfig.EnvParams=JSON.stringify(bootstrapRuntime);return data };
  const boot = await verifyRelease({ ...options, api: bootstrapApi, target: { ...target, origin: 'https://unconfigured.invalid' }, runtime: bootstrapRuntime });
  assert.equal(boot.deploymentVerified, false);assert.equal(boot.artifactVerified, true);assert.equal(boot.observedOrigin, target.origin);
  assert.throws(() => pushedImageDigest('layer sha256:' + 'd'.repeat(64)), /unavailable/);
  assert.throws(() => pushedImageDigest(`v1: digest: ${imageDigest} size: 1\nv2: digest: sha256:${'d'.repeat(64)} size: 2`), /unavailable/);
  assert.equal(pushedImageDigest(`Digest: sha256:${'d'.repeat(64)}\nv1: digest: ${imageDigest} size: 123`), imageDigest);
  assert.throws(() => immutableImage(image + '@' + imageDigest, 'sha256:' + 'd'.repeat(64)), /mismatch/);
});

test('full CloudBase source archive is reproducible from frozen Git with one generated recipe and marker, excluding the dirty workspace', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const manifest = buildManifest(repo, 'HEAD');
  const dirs = [mkdtempSync(join(tmpdir(), 'atoms-source-a-')), mkdtempSync(join(tmpdir(), 'atoms-source-b-'))];
  try {
    const first = createSourcePackage(repo, manifest, dirs[0]);
    const second = createSourcePackage(repo, manifest, dirs[1]);
    assert.equal(first.archiveSha256, second.archiveSha256);
    assert.ok(first.inputs.some(entry => entry.file === 'runtime/team/runner.py'));
    assert.ok(first.inputs.some(entry => entry.file === 'public/examples/tip-calculator-v1.html'));
    assert.ok(!first.inputs.some(entry => /(^scripts\/|^tests\/|^docs\/|\.env|tx\.tokens|node_modules)/.test(entry.file)));
    assert.equal(readFileSync(join(dirs[0], 'context/Dockerfile'), 'utf8'), readFileSync(join(dirs[0], 'context/Dockerfile.vercel'), 'utf8'));
    assert.equal(JSON.parse(readFileSync(join(dirs[0], 'context/runtime/team/release.json'))).sourceDigest, manifest.sourceDigest);
  } finally { dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })); }
});
