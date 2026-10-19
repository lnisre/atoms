import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildManifest, validateManifest, readBlob } from '../release-manifest.mjs';
import { releaseApi } from './release-api.mjs';
import { exactOrigin, validateTarget, runtimeConfiguration, runtimeKeys, configurationItems, configurationFingerprint } from './release-config.mjs';
import { createSourcePackage, digest, immutableImage, pushedImageDigest } from './release-source.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
const versionFields = ['VersionName', 'ImageUrl', 'FlowRatio'];
const recordFields = ['DeployId', 'DeployTime', 'Status', 'RunId', 'BuildId', 'ImageUrl', 'FlowRatio', 'HasTraffic', 'IsReleasing'];
const taskFields = ['Id', 'Status', 'CurrentVersionName', 'VersionName', 'DeployType', 'ReleaseType'];
const imagePattern = /^sha256:[a-f\d]{64}$/;

// Advance Offset only by the provider's Delivered cursor units. Full Python
// builds may exceed a page; never retain raw dependency/build logs as evidence.
export async function readBuildManifest(api, scope) {
  let offset = 0, text = '';
  const pages = [];
  for (let page = 0; page < 100; page++) {
    const result = await api.call('tcbr', 'DescribeCloudRunBuildLog', { ...scope, Offset: offset });
    const log = result.Log;
    if (!log || typeof log.Text !== 'string' || !Number.isInteger(log.Delivered) || log.Delivered < 0
      || !Number.isInteger(log.Total) || log.Total < 0 || typeof log.More !== 'boolean'
      || (log.More && log.Delivered === 0)) throw Error('Build log pagination unavailable');
    if (log.FailType || log.FailReason) throw Error('Build log reports failure');
    text += log.Text + '\n';
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error('Build log evidence limit exceeded');
    pages.push({ offset, delivered: log.Delivered, total: log.Total, more: log.More,
      sha256: digest(log.Text), requestId: result.RequestId });
    offset += log.Delivered;
    if (!log.More) return { digest: pushedImageDigest(text), pages };
  }
  throw Error('Build log pagination limit exceeded');
}

export async function inspectRelease(api, target, attempt) {
  const scope = { EnvId: target.envId, ServerName: target.serverName };
  const [detail, records, task] = await Promise.all([
    api.call('tcbr', 'DescribeCloudRunServerDetail', scope),
    api.call('tcbr', 'DescribeCloudRunDeployRecord', scope),
    api.call('tcbr', 'DescribeServerManageTask', { ...scope, TaskId: attempt?.taskId ?? 0 }),
  ]);
  if (detail.BaseInfo?.ServerName !== target.serverName || detail.ServerConfig?.EnvId !== target.envId
    || detail.ServerConfig?.ServerName !== target.serverName) throw Error('Remote service identity mismatch');
  const versions = detail.OnlineVersionInfos ?? [];
  const current = versions.filter(value => Number(value.FlowRatio) === 100);
  return { raw: { detail, records, task }, safe: {
    checkedAt: new Date().toISOString(), target,
    base: pick(detail.BaseInfo, ['ServerName', 'Status', 'ServerType', 'DefaultDomainName', 'CustomDomainName', 'CustomDomainNames']),
    resources: pick(detail.ServerConfig, ['Cpu', 'Mem', 'MinNum', 'MaxNum', 'Port', 'OpenAccessTypes']),
    versions: versions.map(value => pick(value, versionFields)),
    records: (records.DeployRecords ?? []).map(value => pick(value, recordFields)),
    task: { exists: task.IsExist, ...pick(task.Task, taskFields) },
    unambiguousCurrentVersion: current.length === 1 ? current[0].VersionName : null,
    requests: [detail.RequestId, records.RequestId, task.RequestId],
  } };
}

export function checkServiceConfiguration(detail, target, runtime) {
  const actual = detail.ServerConfig;
  if (!actual || actual.Cpu !== target.cpu || actual.Mem !== target.memory || actual.MinNum !== target.minInstances
    || actual.MaxNum !== 1 || actual.Port !== 3000 || JSON.stringify(actual.OpenAccessTypes) !== '["PUBLIC"]') throw Error('Remote resource or access configuration mismatch');
  let variables; try { variables = JSON.parse(actual.EnvParams); } catch { throw Error('Remote runtime configuration unavailable'); }
  if (JSON.stringify(Object.entries(variables).sort()) !== JSON.stringify(Object.entries(runtime).sort())) throw Error('Remote runtime configuration mismatch');
}

export function prepareRollback(snapshot, recorded, currentVersion, rollbackVersion, execute) {
  if (!recorded || !currentVersion || !rollbackVersion) throw Error('Rollback requires owned attempt and exact current/target versions');
  if (snapshot.safe.unambiguousCurrentVersion !== currentVersion) throw Error('Current version changed');
  const previous = recorded.previous?.unambiguousCurrentVersion;
  if (previous !== rollbackVersion || previous === currentVersion) throw Error('Rollback target is not the recorded prior version');
  if (snapshot.raw.task.IsExist && snapshot.raw.task.Task?.Status !== 'finished') throw Error('Another deployment may be running');
  if (execute) {
    let variables; try { variables = JSON.parse(snapshot.raw.detail.ServerConfig.EnvParams); } catch { throw Error('Remote runtime configuration unavailable'); }
    if (variables.ATOMS_MAINTENANCE !== '1') throw Error('Rollback execution requires the current service maintenance version');
  }
  return { EnvId: recorded.target.envId, ServerName: recorded.target.serverName,
    CurrentVersionName: currentVersion, RollbackVersionName: previous,
    OperatorRemark: `atoms-owned-beta-rollback:${recorded.id}` };
}

function recoveryMatches(snapshot, target, source) {
  const recovery = source.recovery, task = snapshot.raw.task.Task;
  return recovery && source.verifiedTarget?.envId === target.envId && source.verifiedTarget?.serverName === target.serverName
    && target.expectedVersion === recovery.version && snapshot.safe.versions.length === 0
    && snapshot.raw.task.IsExist && task?.Id === recovery.taskId && task.Status === 'failed'
    && task.VersionName === recovery.version && task.DeployType === 'package' && task.FailReason === 'timeout'
    && snapshot.safe.records.some(record => record.DeployId === recovery.deployId && record.BuildId === recovery.buildId
      && record.Status === 'create_failed' && record.ImageUrl === recovery.builtImageTag
      && `${target.serverName}-${record.DeployId}` === recovery.version);
}

export async function verifySourceBuild({ api, target, manifest, source, attempt, submitted, upload }) {
  if (source.image || !submitted?.taskId || submitted.attemptId !== attempt.id || attempt.command !== 'stage' || !attempt.id
    || attempt.sourceCommit !== manifest.commit || attempt.sourceDigest !== manifest.sourceDigest
    || attempt.archiveSha256 !== source.archiveSha256 || upload.archiveSha256 !== source.archiveSha256
    || !upload.packageName || !upload.packageVersion || JSON.stringify(attempt.target) !== JSON.stringify(target)) throw Error('Owned source upload identity unavailable');
  const snapshot = await inspectRelease(api, target, submitted);
  const task = snapshot.raw.task.Task;
  if (!snapshot.raw.task.IsExist || task?.Id !== submitted.taskId || task.Status !== 'failed'
    || task.DeployType !== 'package' || task.FailReason !== 'timeout' || snapshot.safe.versions.length) throw Error('Source recovery requires the owned failed timeout task without an online version');
  for (const [key, expected] of [['PackageName', upload.packageName], ['PackageVersion', upload.packageVersion],
    ['DeployRemark', `atoms:${manifest.commit}:${manifest.sourceDigest}`]]) {
    if (task[key] !== undefined && task[key] !== expected) throw Error('Remote source package metadata mismatch');
  }
  const matches = snapshot.safe.records.filter(record => `${target.serverName}-${record.DeployId}` === task.VersionName
    && record.Status === 'create_failed' && Number.isInteger(record.BuildId) && record.BuildId > 0 && record.ImageUrl);
  if (matches.length !== 1) throw Error('Unique failed source build identity unavailable');
  const record = matches[0];
  const buildEvidence = await readBuildManifest(api, { EnvId: target.envId, ServerName: target.serverName,
    BuildId: record.BuildId, ServerVersion: task.VersionName });
  const image = immutableImage(record.ImageUrl, buildEvidence.digest);
  const final = await inspectRelease(api, target, submitted);
  if (final.raw.task.Task?.FailReason !== 'timeout'
    || JSON.stringify(final.safe) !== JSON.stringify({ ...snapshot.safe, checkedAt: final.safe.checkedAt, requests: final.safe.requests })) throw Error('Source build state changed during verification');
  return { kind: 'cloudbase-source-build', checkedAt: new Date().toISOString(), target,
    sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, sourceAttemptId: attempt.id,
    archiveSha256: source.archiveSha256, packageName: upload.packageName, packageVersion: upload.packageVersion,
    image, buildEvidence, sourceBuildVerified: true, artifactVerified: false, deploymentVerified: false,
    recovery: { taskId: task.Id, version: task.VersionName, buildId: record.BuildId,
      deployId: record.DeployId, builtImageTag: record.ImageUrl, sourceAttemptId: attempt.id },
    outcome: 'image-built-original-version-create-timeout-no-application-health' };
}

export async function stageRelease({ api, target, runtime, manifest, source, readArchive, save, attemptExists }) {
  if (attemptExists()) throw Error('Attempt already recorded; run status before any retry');
  validateTarget(target);
  const billing = await api.call('tcb', 'DescribeBillingInfo', { EnvId: target.envId });
  const actual = billing.EnvBillingInfoList?.find(value => value.EnvId === target.envId);
  if (actual?.PackageId !== 'baas_personal' || actual.EnableOverrun !== false || actual.Status !== 'NORMAL') throw Error('Billing boundary changed; deployment refused');
  const list = await api.call('tcbr', 'DescribeCloudRunServers', { EnvId: target.envId, PageSize: 100, PageNum: 1 });
  if (!Array.isArray(list.ServerList) || list.Total > 100) throw Error('Service inventory incomplete');
  const existing = list.ServerList.find(value => value.ServerName === target.serverName);
  let previous;
  if (existing) {
    if (!target.expectedVersion) throw Error('Existing service requires explicit expectedVersion');
    const snapshot = await inspectRelease(api, target);
    if (source.recovery) {
      if (!recoveryMatches(snapshot, target, source)) throw Error('Owned failed-version recovery no longer matches remote state');
    } else if (snapshot.safe.unambiguousCurrentVersion !== target.expectedVersion) throw Error('Expected remote version changed');
    if (snapshot.raw.task.IsExist && !['finished', 'failed'].includes(snapshot.raw.task.Task?.Status)) throw Error('Another deployment may be running');
    previous = snapshot.safe;
  } else if (target.expectedVersion) throw Error('Expected service missing');
  const attempt = { id: randomUUID(), startedAt: new Date().toISOString(), command: 'stage', target,
    sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest,
    archiveSha256: source?.archiveSha256, image: source?.image, previous,
    phase: 'recorded-before-request' };
  save('attempt.json', attempt);
  let deploy;
  if (source.image) {
    if (!/@sha256:[a-f\d]{64}$/.test(source.image)) throw Error('Stage image must be immutable');
    deploy = { DeployType: 'image', ImageUrl: source.image };
  } else {
    const archive = readArchive();
    if (digest(archive) !== source.archiveSha256) throw Error('Frozen archive changed');
    const descriptor = await api.call('tcb', 'DescribeCloudBaseBuildService', { EnvId: target.envId, ServiceName: target.serverName });
    if (!descriptor.PackageName || !descriptor.PackageVersion) throw Error('Missing source package identity');
    await api.upload(descriptor, archive);
    deploy = { DeployType: 'package', PackageName: descriptor.PackageName, PackageVersion: descriptor.PackageVersion };
    save('upload.json', { packageName: descriptor.PackageName, packageVersion: descriptor.PackageVersion,
      archiveSha256: source.archiveSha256, requestId: descriptor.RequestId });
  }
  const result = await api.call('tcbr', existing ? 'UpdateCloudRunServer' : 'CreateCloudRunServer', {
    EnvId: target.envId, ServerName: target.serverName,
    DeployInfo: { ...deploy, ReleaseType: 'FULL', DeployRemark: `atoms:${manifest.commit}:${manifest.sourceDigest}` },
    Items: configurationItems(target, runtime),
  });
  save('submitted.json', { attemptId: attempt.id, requestId: result.RequestId, taskId: result.TaskId,
    submittedAt: new Date().toISOString(), outcome: 'submitted-not-verified' });
  return { attemptId: attempt.id, taskId: result.TaskId, outcome: 'submitted-not-verified' };
}

export async function verifyRelease({ api, target, runtime, manifest, attempt, health, source, fetcher = fetch }) {
  const snapshot = await inspectRelease(api, target, attempt);
  checkServiceConfiguration(snapshot.raw.detail, target, runtime);
  const current = snapshot.safe.versions.filter(value => Number(value.FlowRatio) === 100);
  if (snapshot.safe.base.Status !== 'normal' || current.length !== 1 || !current[0].VersionName
    || !current[0].ImageUrl || (attempt.previous?.unambiguousCurrentVersion === current[0].VersionName)
    || (snapshot.raw.task.IsExist && snapshot.raw.task.Task?.Status !== 'finished')) throw Error('Release is not uniquely ready');
  const base = snapshot.safe.base;
  const origins = [base.DefaultDomainName, base.CustomDomainName, ...(base.CustomDomainNames ?? [])].filter(Boolean)
    .map(value => exactOrigin(value.startsWith('https://') ? value : `https://${value}`));
  const bootstrap = target.origin === 'https://unconfigured.invalid';
  if (!origins.length || (!bootstrap && !origins.includes(target.origin))) throw Error('Target origin is not bound to the remote service');
  const observedOrigin = bootstrap ? origins[0] : target.origin;
  const matching = snapshot.safe.records.filter(record => record.ImageUrl === current[0].ImageUrl
    && ['running', 'normal'].includes(record.Status) && record.BuildId > 0);
  let imageDigest, buildId, buildEvidence;
  if (source.image) {
    imageDigest = source.image.split('@')[1];
    if (current[0].ImageUrl !== source.image) throw Error('Running immutable image identity unavailable or mismatched');
  } else {
    if (matching.length !== 1 || !Number.isInteger(matching[0].BuildId)) throw Error('Unique source build identity unavailable');
    buildId = matching[0].BuildId;
    buildEvidence = await readBuildManifest(api, { EnvId: target.envId,
      ServerName: target.serverName, BuildId: buildId, ServerVersion: current[0].VersionName });
    imageDigest = buildEvidence.digest;
  }
  if (!imagePattern.test(imageDigest)) throw Error('Image manifest digest unavailable');
  // Default-domain confirmation is a normal browser action. A supplied health
  // observation can come from that browser session; this CLI never spoofs the
  // platform's navigation headers or invents a confirmation cookie.
  let observation;
  if (health) {
    if (health.origin !== observedOrigin || !Number.isFinite(Date.parse(health.observedAt))
      || Math.abs(Date.now()-Date.parse(health.observedAt)) > 600_000) throw Error('Browser health origin/time mismatch');
    observation = health.body;
  }
  if (!observation) {
    const response = await fetcher(observedOrigin + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')
      || !response.headers.get('cache-control')?.includes('no-store')) throw Error('App health not directly available; complete normal browser confirmation and provide its observation');
    observation = await response.json();
  }
  if (observation.status !== 'ready' || observation.nextReady !== true || observation.stopping !== false
    || observation.sourceCommit !== manifest.commit || observation.sourceDigest !== manifest.sourceDigest
    || observation.protocol !== 'atoms-team/3' || observation.maintenance !== Boolean(target.maintenance)
    || !Number.isInteger(observation.activeConnections)) throw Error('Frozen application health mismatch');
  // Re-read after the probe; concurrent traffic/version changes must fail closed.
  const final = await inspectRelease(api, target, attempt);
  if (JSON.stringify(final.safe.versions) !== JSON.stringify(snapshot.safe.versions)) throw Error('Version changed during verification');
  checkServiceConfiguration(final.raw.detail, target, runtime);
  return { kind: 'cloudbase-application-deployment', checkedAt: new Date().toISOString(), target,
    sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, version: current[0].VersionName,
    image: immutableImage(current[0].ImageUrl, imageDigest), buildId, buildEvidence,
    healthEvidence: health ? 'supplied-browser-observation-requires-independent-review' : 'direct-https-response',
    configFingerprint: configurationFingerprint(runtime, Buffer.from(attempt.fingerprintKey, 'hex')).fingerprint,
    artifactVerified: true, deploymentVerified: !bootstrap, observedOrigin,
    originStatus: bootstrap ? 'bootstrap-business-origin-disabled' : 'bound-to-service',
    health: pick(observation, ['status', 'nextReady', 'protocol', 'sourceCommit', 'sourceDigest', 'activeConnections', 'maintenance']),
    productAcceptance: 'pending-verify-atoms', wss600Seconds: 'pending-platform-evidence',
    realEmail: 'pending', realModel: 'pending', productionCutover: 'not-performed' };
}

async function main(args) {
  const [command, directory, ...flags] = args;
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index]; if (!/^--[a-z-]+$/.test(key) || !flags[index + 1] || options[key]) throw Error('Invalid or duplicate option');
    options[key] = flags[index + 1];
  }
  if (!['plan', 'stage', 'status', 'verify', 'build-artifact', 'promote', 'rollback'].includes(command) || !directory) throw Error('Usage: release.mjs plan|stage|status|verify|build-artifact|promote|rollback DIRECTORY [--option VALUE]');
  if (Object.keys(options).some(key => !['--ref', '--target', '--runtime', '--runtime-env', '--credentials', '--health', '--image-verification', '--current-version', '--rollback-version', '--execute'].includes(key))) throw Error('Unknown option');
  const dir = resolve(directory);
  const save = (name, value) => writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const load = name => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  if (command === 'plan') {
    if (!/^[a-f\d]{40}$/.test(options['--ref'] ?? '') || !options['--target']) throw Error('Plan requires full frozen commit and explicit target JSON');
    const manifest = buildManifest(repo, options['--ref']);
    const target = validateTarget(JSON.parse(readFileSync(options['--target'], 'utf8')));
    mkdirSync(dir, { mode: 0o700 }); save('manifest.json', manifest); save('target.json', target);
    let merged = false; try { execFileSync('git', ['merge-base', '--is-ancestor', manifest.commit, 'origin/master'], { cwd: repo, stdio: 'ignore' }); merged = true; } catch { /* Candidate stage is permitted; production requires merged source. */ }
    let source;
    if (options['--image-verification']) {
      const prior = JSON.parse(readFileSync(options['--image-verification'], 'utf8'));
      const deployment = prior.kind === 'cloudbase-application-deployment' && prior.artifactVerified;
      const build = prior.kind === 'cloudbase-source-build' && prior.sourceBuildVerified && prior.recovery
        && !prior.artifactVerified && !prior.deploymentVerified && target.expectedVersion === prior.recovery.version
        && target.envId === prior.target?.envId && target.serverName === prior.target?.serverName;
      if ((!deployment && !build)
        || prior.sourceCommit !== manifest.commit || prior.sourceDigest !== manifest.sourceDigest) throw Error('Verified image source mismatch');
      source = { image: immutableImage(prior.image, prior.image?.split('@')[1]),
        verifiedVersion: prior.version ?? prior.recovery?.version, verifiedTarget: prior.target,
        ...(build ? { recovery: prior.recovery } : {}) };
    } else source = createSourcePackage(repo, manifest, dir);
    save('source.json', source); save('plan.json', { kind: 'isolated-beta-plan', target, merged,
      sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, source,
      productionTraffic: 'unchanged', status: 'not-deployed', publicAcceptance: 'pending' });
    return { sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, merged, target, archiveSha256: source.archiveSha256, status: 'not-deployed' };
  }
  const manifest = validateManifest(repo, load('manifest.json')), target = validateTarget(load('target.json'));
  const plan = load('plan.json');
  if (plan.sourceCommit !== manifest.commit || plan.sourceDigest !== manifest.sourceDigest
    || JSON.stringify(plan.target) !== JSON.stringify(target) || JSON.stringify(plan.source) !== JSON.stringify(load('source.json'))) throw Error('Frozen plan changed');
  if (command === 'promote') {
    const verified = load('verification.json');
    if (!verified.deploymentVerified || verified.sourceCommit !== manifest.commit || verified.sourceDigest !== manifest.sourceDigest
      || JSON.stringify(verified.target) !== JSON.stringify(target) || !/@sha256:[a-f\d]{64}$/.test(verified.image)) throw Error('Verified release identity mismatch');
    if (options['--execute']) throw Error('Production mutation is not authorized by a beta verification; use the separate cutover workflow');
    const prepared = { operation: 'production-release-preparation', image: verified.image,
      sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, betaVersion: verified.version,
      required: ['merged frozen source', 'verified production origin and resources', 'product and 600-second entry evidence',
        'explicit production authorization', 'maintenance/drain and rollback rehearsal', 'matching stable runtime secrets'],
      status: 'prepared-not-promoted', productionTraffic: 'unchanged' };
    save('promotion-preparation.json', prepared); return prepared;
  }
  if (!options['--credentials']) throw Error('Explicit management credential file required');
  const credentials = parseEnv(readFileSync(options['--credentials'], 'utf8'));
  const api = releaseApi({ credentials, ...target });
  const submitted = existsSync(resolve(dir, 'submitted.json')) ? load('submitted.json') : undefined;
  const recorded = existsSync(resolve(dir, 'attempt.json')) ? load('attempt.json') : undefined;
  if (command === 'status') {
    const result = (await inspectRelease(api, target, submitted)).safe;
    save(`status-${Date.now()}.json`, result); return result;
  }
  if (command === 'build-artifact') {
    if (!recorded || !submitted) throw Error('No owned source stage attempt');
    const result = await verifySourceBuild({ api, target, manifest, source: load('source.json'),
      attempt: recorded, submitted, upload: load('upload.json') });
    save('build-artifact.json', result); return result;
  }
  if (command === 'rollback') {
    const snapshot = await inspectRelease(api, target);
    const request = prepareRollback(snapshot, recorded, options['--current-version'], options['--rollback-version'], options['--execute'] === 'yes');
    if (options['--execute'] !== 'yes') return { request, outcome: 'prepared-not-rolled-back' };
    save('rollback-attempt.json', { ...request, startedAt: new Date().toISOString() });
    const result = await api.call('tcbr', 'SubmitServerRollback', request);
    const outcome = { requestId: result.RequestId, taskId: result.TaskId, outcome: 'submitted-not-verified' };
    save('rollback-submitted.json', outcome); return outcome;
  }
  if (Boolean(options['--runtime']) === Boolean(options['--runtime-env'])) throw Error('Choose exactly one explicit runtime file or --runtime-env yes');
  if (options['--runtime-env'] && options['--runtime-env'] !== 'yes') throw Error('Invalid runtime environment option');
  const runtime = runtimeConfiguration(target, options['--runtime-env'] ? pick(process.env, runtimeKeys)
    : parseEnv(readFileSync(options['--runtime'], 'utf8')));
  const source = load('source.json');
  if (command === 'stage') {
    const secrets = [...['DEEPSEEK_API_KEY', 'ATOMS_AUTH_SECRET', 'ATOMS_ARTIFACT_SECRET', 'QA_TOOL_SIGNING_KEY'].map(key => runtime[key]),
      credentials.TENCENTCLOUD_SECRETID, credentials.TENCENTCLOUD_SECRETKEY, credentials.TENCENTCLOUD_SESSIONTOKEN].filter(value => value?.length >= 16);
    for (const entry of manifest.files) {
      const content = readBlob(repo, entry.blob);
      if (secrets.some(value => content.includes(Buffer.from(value)))) throw Error('Credential found in frozen source');
    }
    const fingerprint = configurationFingerprint(runtime);
    return stageRelease({ api, target, runtime, manifest, source,
      readArchive: () => readFileSync(resolve(dir, 'source.zip')),
      attemptExists: () => existsSync(resolve(dir, 'attempt.json')),
      save: (name, value) => save(name, name === 'attempt.json' ? { ...value, fingerprintKey: fingerprint.key,
        configFingerprint: fingerprint.fingerprint } : value) });
  }
  if (!recorded) throw Error('No owned stage attempt');
  const key = Buffer.from(recorded.fingerprintKey, 'hex');
  if (configurationFingerprint(runtime, key).fingerprint !== recorded.configFingerprint) throw Error('Runtime changed since stage');
  const verified = await verifyRelease({ api, target, runtime, manifest, source, attempt: { ...recorded, ...submitted },
    health: options['--health'] ? JSON.parse(readFileSync(options['--health'], 'utf8')) : undefined });
  save('verification.json', verified); return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(value => console.log(JSON.stringify(value))).catch(error => {
    // Never print SDK errors, request bodies, signed upload URLs or raw responses.
    console.error(JSON.stringify({ error: error?.name === 'ReleaseApiError' ? error.message : 'Release operation refused',
      reason: error?.name === 'ReleaseApiError' ? undefined : String(error?.message).replace(/[\r\n]/g, ' ').slice(0, 220),
      requestId: error?.requestId })); process.exitCode = 1;
  });
}
