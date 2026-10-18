import { createHmac, randomBytes } from 'node:crypto';

export const runtimeKeys = ['DEEPSEEK_API_KEY', 'CLOUDBASE_ENV_ID', 'ATOMS_PROJECT_NAMESPACE',
  'ATOMS_AUTH_SECRET', 'ATOMS_ARTIFACT_SECRET', 'QA_TOOL_SIGNING_KEY', 'ATOMS_APP_ORIGIN'];
const secretKeys = ['DEEPSEEK_API_KEY', 'ATOMS_AUTH_SECRET', 'ATOMS_ARTIFACT_SECRET', 'QA_TOOL_SIGNING_KEY'];
const targetKeys = ['envId', 'region', 'serverName', 'productionServerName', 'origin', 'cpu', 'memory',
  'minInstances', 'maxInstances', 'dataMode', 'namespace', 'expectedVersion', 'sharedDataAuthorized'];
export function exactOrigin(value) {
  let url; try { url = new URL(value); } catch { throw Error('Invalid exact HTTPS origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw Error('Invalid exact HTTPS origin');
  return value;
}
export function validateTarget(target) {
  if (Object.keys(target).some(key => !targetKeys.includes(key))) throw Error('Unknown target configuration');
  if (!/^[a-z\d-]+$/.test(target.envId) || target.region !== 'ap-shanghai'
    || !/^[a-z][a-z\d-]{2,44}$/.test(target.serverName)
    || !/^[a-z][a-z\d-]{2,44}$/.test(target.productionServerName)
    || target.serverName === target.productionServerName) throw Error('Invalid isolated service target');
  exactOrigin(target.origin);
  if (![0.5, 1, 2, 4].includes(target.cpu) || target.memory !== target.cpu * 2
    || ![0, 1].includes(target.minInstances) || target.maxInstances !== 1) throw Error('Unsupported bounded resource configuration');
  if (!['isolated', 'existing-account-data'].includes(target.dataMode)
    || !/^atoms(?:_[a-z0-9]{1,24})?$/.test(target.namespace)
    || (target.dataMode === 'isolated' && target.namespace === 'atoms')
    || (target.dataMode === 'existing-account-data' && target.sharedDataAuthorized !== true)) throw Error('Explicit data isolation or shared-data authorization required');
  if (target.expectedVersion && !/^[a-zA-Z\d_-]{3,100}$/.test(target.expectedVersion)) throw Error('Invalid expected version');
  return target;
}
export function runtimeConfiguration(target, input) {
  validateTarget(target);
  if (Object.keys(input).some(key => !runtimeKeys.includes(key))) throw Error('Unknown runtime configuration; management and test credentials are forbidden');
  for (const key of runtimeKeys) if (typeof input[key] !== 'string' || !input[key].trim() || /[\r\n\0]/.test(input[key])) throw Error(`Missing or invalid runtime configuration: ${key}`);
  if (input.CLOUDBASE_ENV_ID !== target.envId || input.ATOMS_APP_ORIGIN !== target.origin
    || input.ATOMS_PROJECT_NAMESPACE !== target.namespace) throw Error('Runtime target mismatch');
  for (const key of secretKeys) if (input[key].length < 32) throw Error(`Runtime secret too short: ${key}`);
  for (const key of ['ATOMS_AUTH_SECRET', 'ATOMS_ARTIFACT_SECRET']) if (!/^[a-f\d]{64}$/i.test(input[key])) throw Error(`Runtime secret must be 64 hex characters: ${key}`);
  // Salt each plan's fingerprint; only a digest of the full high-entropy runtime
  // configuration is recorded, never a digest of an individual secret.
  return { ...input, ATOMS_HOSTING: 'cloudbase' };
}
export function configurationFingerprint(runtime, key = randomBytes(32)) {
  return { key: key.toString('hex'), fingerprint: createHmac('sha256', key)
    .update(JSON.stringify(Object.entries(runtime).sort(([a], [b]) => a.localeCompare(b)))).digest('hex') };
}
export function configurationItems(target, runtime) {
  return [
    { Key: 'CpuSpecs', FloatValue: target.cpu }, { Key: 'MemSpecs', FloatValue: target.memory },
    { Key: 'MinNum', IntValue: target.minInstances }, { Key: 'MaxNum', IntValue: 1 },
    { Key: 'Port', IntValue: 3000 }, { Key: 'AccessTypes', ArrayValue: ['PUBLIC'] },
    { Key: 'HasDockerfile', BoolValue: true }, { Key: 'Dockerfile', Value: 'Dockerfile' },
    { Key: 'InitialDelaySeconds', IntValue: 0 }, { Key: 'LogPath', Value: 'stdout' },
    { Key: 'EnvParam', Value: JSON.stringify(runtime) },
  ];
}
