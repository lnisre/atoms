// Management-only, read-only inventory. Never imported by the application.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

const versions = { tcb: '2018-06-08', tcbr: '2022-02-17' };
const actions = {
  tcb: new Set(['DescribeEnvInfo', 'DescribeBillingInfo', 'DescribeEnvAccountCircle',
    'DescribeEnvPlans', 'DescribeCreditsUsage', 'DescribeCreditsUsageDetail', 'DescribeHTTPServiceRoute']),
  tcbr: new Set(['DescribeEnvBaseInfo', 'DescribeCloudRunServers']),
};
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined)
  .map(key => [key, object[key]]));
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const billingFields = ['EnvId', 'PackageId', 'PackageName', 'Status', 'PayMode',
  'ExpireTime', 'EnableOverrun', 'IsAutoRenew', 'EnvDeductionMode', 'EnvCharged', 'EnvActivated'];
const envFields = ['EnvId', 'Region', 'Status', 'EnvType', 'PackageType', 'PackageId', 'PackageName'];

export function readOnlyApi(config, envId, region, fetcher = fetch) {
  if (!/^[a-z\d-]+$/.test(envId) || !/^ap-[a-z]+$/.test(region)) throw Error('Invalid target');
  if ([config.CLOUDBASE_ENV_ID, config.TENCENTCLOUD_ENVID].some(value => value && value !== envId)) {
    throw Error('Environment mismatch');
  }
  const secretId = config.TENCENTCLOUD_SECRETID?.trim();
  const secretKey = config.TENCENTCLOUD_SECRETKEY?.trim();
  if (!secretId || !secretKey) throw Error('Missing management credentials');
  return async (service, action, params = {}) => {
    if (!actions[service]?.has(action)) throw Error('Read-only action not allowed');
    if (params.EnvId && params.EnvId !== envId) throw Error('Environment mismatch');
    const body = JSON.stringify(params), host = `${service}.tencentcloudapi.com`;
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const type = 'application/json; charset=utf-8', signed = 'content-type;host';
    const scope = `${date}/${service}/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:${type}\nhost:${host}\n\n${signed}\n${hash(body)}`;
    const signature = createHmac('sha256', hmac(hmac(hmac(`TC3${secretKey}`, date), service), 'tc3_request'))
      .update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest('hex');
    try {
      const response = await fetcher(`https://${host}`, { method: 'POST', headers: {
        'Content-Type': type, 'X-TC-Action': action, 'X-TC-Version': versions[service],
        'X-TC-Region': region, 'X-TC-Timestamp': String(timestamp),
        Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
        ...(config.TENCENTCLOUD_SESSIONTOKEN ? { 'X-TC-Token': config.TENCENTCLOUD_SESSIONTOKEN } : {}),
      }, body, signal: AbortSignal.timeout(30_000) });
      const data = (await response.json()).Response;
      const summary = { action, requestId: data?.RequestId, httpStatus: response.status,
        errorCode: data?.Error?.Code };
      if (!response.ok || !data?.RequestId || data.Error) return { summary };
      // The caller must project known fields before printing or persisting data.
      return { summary, data };
    } catch (error) {
      return { summary: { action, errorCode: error?.name === 'TimeoutError' ? 'Timeout' : 'TransportFailure' } };
    }
  };
}

export async function auditHosting({ config, envId, region = 'ap-shanghai', fetcher, now = new Date() }) {
  const call = readOnlyApi(config, envId, region, fetcher);
  const summaries = [];
  const read = async (service, action, params) => {
    const result = await call(service, action, params);
    summaries.push(result.summary);
    return result.data;
  };
  const [billing, environment, hosting, cycle] = await Promise.all([
    read('tcb', 'DescribeBillingInfo', { EnvId: envId }),
    read('tcb', 'DescribeEnvInfo', { EnvId: envId }),
    read('tcbr', 'DescribeEnvBaseInfo', { EnvId: envId }),
    read('tcb', 'DescribeEnvAccountCircle', { EnvId: envId }),
  ]);
  const currentBilling = billing?.EnvBillingInfoList?.find(item => item.EnvId === envId);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
  const startDate = cycle?.StartTime?.slice(0, 10);
  const usageParams = startDate && /^\d{4}-\d\d-\d\d$/.test(startDate)
    ? { EnvId: envId, StartDate: startDate, EndDate: date } : undefined;
  const [plans, gateway, servers, usage, modules] = await Promise.all([
    currentBilling?.PackageId ? read('tcb', 'DescribeEnvPlans', { PackageId: currentBilling.PackageId }) : undefined,
    read('tcb', 'DescribeHTTPServiceRoute', { EnvId: envId, Limit: 100, Offset: 0 }),
    read('tcbr', 'DescribeCloudRunServers', { EnvId: envId, PageSize: 100, PageNum: 1 }),
    usageParams ? read('tcb', 'DescribeCreditsUsage', usageParams) : undefined,
    usageParams ? read('tcb', 'DescribeCreditsUsageDetail', { ...usageParams, NeedUsageDetails: false,
      Modules: ['EKS', 'PostgreSQL', 'Auth', 'APIInvocation', 'HTTPInvocation', 'COS', 'HOSTING', 'SCF', 'Other'] }) : undefined,
  ]);
  const domains = gateway?.Domains?.map(domain => ({
    ...pick(domain, ['Domain', 'DomainType', 'AccessType', 'Protocol', 'IsDefault', 'Enable', 'Status', 'DNSStatus']),
    routes: domain.Routes?.map(route => pick(route, ['Path', 'UpstreamResourceType', 'UpstreamResourceName',
      'EnableAuth', 'EnableSafeDomain', 'EnablePathTransmission', 'Enable'])),
  }));
  return {
    observedAt: now.toISOString(), target: { envId, region },
    billing: pick(currentBilling, billingFields),
    environment: pick(environment?.EnvInfo?.EnvBaseInfo, envFields),
    hostingBase: { exists: hosting?.IsExist, ...pick(hosting?.EnvBaseInfo, envFields) },
    cycle: pick(cycle, ['StartTime', 'EndTime']),
    plans: plans?.PlanList?.map(plan => {
      let limit;
      try { limit = JSON.parse(plan.ResourceLimit); } catch { /* A missing quota remains unknown. */ }
      return { ...pick(plan, ['PackageId', 'PackageTitle', 'UnitPrice']),
        monthlyCredits: limit?.Credits?.MaxSize, qps: limit?.Qps };
    }),
    usage: usage && { ...pick(usage, ['DeductValue', 'PackageDeductValue', 'ReportValue', 'HistoryDeducted']),
      period: usageParams, modules: modules?.Usages?.map(module => pick(module,
        ['Module', 'CreditsValue', 'DeductValue', 'PackageDeductValue', 'ReportValue'])) },
    gateway: { total: gateway?.TotalCount, truncated: gateway?.TotalCount > 100, domains },
    servers: { total: servers?.Total, truncated: servers?.Total > 100, items: servers?.ServerList?.map(server =>
      pick(server, ['ServerName', 'Status', 'CustomDomainName', 'CustomDomainNames', 'DefaultDomainName'])) },
    requests: summaries,
    gate: { publicEntry: 'unverified', wss600Seconds: 'unverified', releaseAndRollback: 'unverified',
      nextTicketReleased: false },
    caveat: 'Read-only inventory does not verify current spendable balance, deployment permission, container resources or public-entry behaviour. Resource usage can be delayed by up to two days.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const value = name => args[args.indexOf(name) + 1];
    if (!args.includes('--credentials') || !args.includes('--env')) throw Error('Requires --credentials and --env');
    const result = await auditHosting({ config: parseEnv(readFileSync(value('--credentials'), 'utf8')),
      envId: value('--env'), region: args.includes('--region') ? value('--region') : 'ap-shanghai' });
    const json = JSON.stringify(result, null, 2) + '\n';
    if (args.includes('--out')) writeFileSync(value('--out'), json, { mode: 0o600, flag: 'wx' });
    else process.stdout.write(json);
    if (result.requests.some(request => request.errorCode)) process.exitCode = 1;
  } catch {
    console.error('CloudBase inventory failed; check explicit target, credential file and arguments. Raw errors are suppressed.');
    process.exitCode = 1;
  }
}
