// Management-only CloudBase transport. Never imported by application code.
// Contract checked against @cloudbase/manager-node 5.9.1 and Tencent's official
// tcbr/v20220217 SDK. Project only safe summaries of responses before recording.
import { createHash, createHmac } from 'node:crypto';

const actions = {
  tcb: new Set(['DescribeBillingInfo', 'DescribeCloudBaseBuildService']),
  tcbr: new Set(['DescribeCloudRunServers', 'DescribeCloudRunServerDetail',
    'DescribeCloudRunDeployRecord', 'DescribeCloudRunBuildLog', 'DescribeCloudRunProcessLog', 'DescribeVersionDetail',
    'DescribeServerManageTask', 'CreateCloudRunServer', 'UpdateCloudRunServer', 'SubmitServerRollback']),
};
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
export class ReleaseApiError extends Error {
  constructor(action, code, requestId) {
    super(`CloudBase ${action} failed (${code})`);
    this.name = 'ReleaseApiError'; this.code = code; this.requestId = requestId;
  }
}

export function releaseApi({ credentials, envId, region, serverName, fetcher = fetch }) {
  if (!/^[a-z\d-]+$/.test(envId) || !/^ap-[a-z]+$/.test(region)
    || !/^[a-z][a-z\d-]{2,44}$/.test(serverName)) throw Error('Invalid CloudBase target');
  if ([credentials.CLOUDBASE_ENV_ID, credentials.TENCENTCLOUD_ENVID].some(value => value && value !== envId)) throw Error('Credential environment mismatch');
  if (!credentials.TENCENTCLOUD_SECRETID || !credentials.TENCENTCLOUD_SECRETKEY) throw Error('Missing management credentials');
  const ownedRunIds = new Set();
  const call = async (service, action, params = {}) => {
    if (!actions[service]?.has(action) || params.EnvId !== envId
      || (params.ServerName && params.ServerName !== serverName)
      || (params.ServiceName && params.ServiceName !== serverName)
      || (action === 'DescribeCloudRunProcessLog' && !ownedRunIds.has(params.RunId))) throw Error('CloudBase action outside release scope');
    const body = JSON.stringify(params), host = `${service}.tencentcloudapi.com`;
    const timestamp = Math.floor(Date.now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const type = 'application/json; charset=utf-8', signed = 'content-type;host', scope = `${date}/${service}/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:${type}\nhost:${host}\n\n${signed}\n${hash(body)}`;
    const signature = createHmac('sha256', hmac(hmac(hmac(`TC3${credentials.TENCENTCLOUD_SECRETKEY}`, date), service), 'tc3_request'))
      .update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest('hex');
    try {
      const response = await fetcher(`https://${host}`, { method: 'POST', headers: {
        'Content-Type': type, 'X-TC-Action': action, 'X-TC-Version': service === 'tcbr' ? '2022-02-17' : '2018-06-08',
        'X-TC-Region': region, 'X-TC-Timestamp': String(timestamp),
        Authorization: `TC3-HMAC-SHA256 Credential=${credentials.TENCENTCLOUD_SECRETID}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
        ...(credentials.TENCENTCLOUD_SESSIONTOKEN ? { 'X-TC-Token': credentials.TENCENTCLOUD_SESSIONTOKEN } : {}),
      }, body, redirect: 'error', signal: AbortSignal.timeout(60_000) });
      const data = (await response.json()).Response;
      if (!response.ok || data?.Error || !data?.RequestId) throw new ReleaseApiError(action,
        /^[\w.]+$/.test(data?.Error?.Code) ? data.Error.Code : `HTTP${response.status}`, data?.RequestId);
      if (action === 'DescribeCloudRunDeployRecord') for (const record of data.DeployRecords ?? []) {
        if (typeof record.RunId === 'string') ownedRunIds.add(record.RunId);
      }
      return data;
    } catch (error) {
      if (error instanceof ReleaseApiError) throw error;
      throw new ReleaseApiError(action, 'TransportOutcomeUnknown');
    }
  };
  return { call, upload: async (descriptor, bytes) => {
    const url = new URL(descriptor.UploadUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'cloudbaserun-code-cos.cloudbase.net'
      || url.username || url.password || url.port) throw Error('Untrusted build upload target');
    try {
      const response = await fetcher(url, { method: 'PUT', headers: Object.fromEntries(
        (descriptor.UploadHeaders ?? []).map(item => [item.Key, item.Value])), body: bytes,
        redirect: 'error', signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw Error();
    } catch { throw new ReleaseApiError('SourceUpload', 'UploadOutcomeUnknown'); }
  } };
}
