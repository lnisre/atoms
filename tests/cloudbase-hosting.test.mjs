import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { auditHosting, readOnlyApi } from '../scripts/cloudbase/audit-hosting.mjs';
import { startProbe } from '../scripts/cloudbase/hosting-probe/server.mjs';

const config = { TENCENTCLOUD_SECRETID: 'SENSITIVE_ID', TENCENTCLOUD_SECRETKEY: 'SENSITIVE_KEY',
  CLOUDBASE_ENV_ID: 'synthetic-env' };

test('inventory reports real package/cycle separately from hosting metadata and strips credential-shaped response fields', async () => {
  const requests = [];
  const responses = {
    DescribeBillingInfo: { EnvBillingInfoList: [{ EnvId: 'synthetic-env', PackageId: 'baas_personal',
      EnableOverrun: false, SecretKey: 'SENSITIVE_RESPONSE' }] },
    DescribeEnvInfo: { EnvInfo: { EnvBaseInfo: { EnvId: 'synthetic-env', Region: 'ap-shanghai' },
      UserInfo: { Uin: 'SENSITIVE_UIN' } } },
    DescribeEnvBaseInfo: { IsExist: true, EnvBaseInfo: { PackageType: 'Trial' } },
    DescribeEnvAccountCircle: { StartTime: '2026-10-15 00:51:59', EndTime: '2026-11-15 23:59:59' },
    DescribeEnvPlans: { PlanList: [{ PackageId: 'baas_personal', ResourceLimit: '{"Credits":{"MaxSize":"40000"}}' }] },
    DescribeCreditsUsage: { DeductValue: 100 }, DescribeCreditsUsageDetail: { Usages: [] },
    DescribeHTTPServiceRoute: { TotalCount: 1, Domains: [{ Domain: 'synthetic.invalid', IsDefault: false,
      Routes: [{ Path: '/', Extension: { Headers: { Authorization: 'SENSITIVE_HEADER' } } }] }] },
    DescribeCloudRunServers: { Total: 0, ServerList: [] },
  };
  const fetcher = async (_url, options) => {
    const action = options.headers['X-TC-Action']; requests.push({ action, params: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ Response: { ...responses[action], RequestId: action } }) };
  };
  const report = await auditHosting({ config, envId: 'synthetic-env', fetcher,
    now: new Date('2026-10-18T16:30:00Z') });
  assert.equal(report.billing.PackageId, 'baas_personal');
  assert.equal(report.hostingBase.PackageType, 'Trial');
  assert.equal(report.plans[0].monthlyCredits, '40000');
  assert.equal(report.gate.nextTicketReleased, false);
  const usage = requests.find(item => item.action === 'DescribeCreditsUsage');
  assert.equal(usage.params.StartDate, '2026-10-15');
  assert.equal(usage.params.EndDate, '2026-10-19');
  assert.doesNotMatch(JSON.stringify(report), /SENSITIVE/);
  assert.ok(requests.every(item => item.action.startsWith('Describe')));
});

test('inventory suppresses API/transport raw errors and rejects mismatched environment and mutation actions', async () => {
  assert.throws(() => readOnlyApi(config, 'other-env', 'ap-shanghai'), /mismatch/);
  const api = readOnlyApi(config, 'synthetic-env', 'ap-shanghai', async () => ({
    ok: true, status: 200, json: async () => ({ Response: { RequestId: 'synthetic',
      Error: { Code: 'UnauthorizedOperation', Message: 'SENSITIVE_ERROR' } } }),
  }));
  await assert.rejects(api('tcb', 'ModifyEnvPlan'), /not allowed/);
  const failed = await api('tcb', 'DescribeBillingInfo');
  assert.equal(failed.summary.errorCode, 'UnauthorizedOperation');
  assert.equal(failed.data, undefined);
  assert.doesNotMatch(JSON.stringify(failed), /SENSITIVE/);
});

test('synthetic probe preserves multiple cookies, rejects invalid origin/path/session and carries real WebSocket messages', async t => {
  const logs = [], origin = 'http://127.0.0.1';
  const probe = startProbe({ origin, port: 0, host: '127.0.0.1', log: event => logs.push(JSON.parse(event)) });
  await once(probe.server, 'listening');
  t.after(() => probe.stop());
  const base = `http://127.0.0.1:${probe.server.address().port}`;
  const page = await fetch(base + '/probe');
  assert.equal(page.headers.getSetCookie().length, 2);
  assert.ok(!page.headers.has('Content-Disposition'));
  const cookie = 'atoms_probe_a=synthetic-a; atoms_probe_b=synthetic-b';
  const cookies = await fetch(base + '/probe/cookies', { headers: { Cookie: cookie } }).then(response => response.json());
  assert.equal(cookies.cookiesPresent, true);
  const connect = (path, headers) => new WebSocket(base.replace('http:', 'ws:') + path,
    'atoms-hosting-probe.v1', { headers });
  for (const [path, headers, code] of [
    ['/probe/socket?mode=normal', { Origin: 'https://bad.invalid', Cookie: cookie }, 403],
    ['/probe/socket?mode=normal', { Origin: origin }, 403],
    ['/wrong?mode=normal', { Origin: origin, Cookie: cookie }, 404],
  ]) {
    await new Promise((resolve, reject) => {
      const ws = connect(path, headers);
      ws.on('unexpected-response', (_request, response) => {
        try { assert.equal(response.statusCode, code); response.resume(); ws.terminate(); resolve(); }
        catch (error) { reject(error); }
      });
      ws.on('error', () => {});
      ws.on('open', () => reject(Error('Invalid upgrade was accepted')));
    });
  }
  const ws = connect('/probe/socket?mode=normal', { Origin: origin, Cookie: cookie });
  const ready = once(ws, 'message');
  await once(ws, 'open');
  assert.equal(JSON.parse((await ready)[0]).type, 'ready');
  for (const [type, expected] of [['heartbeat', 'heartbeat-ack'], ['echo', 'echo']]) {
    const message = once(ws, 'message'); ws.send(JSON.stringify({ type }));
    assert.equal(JSON.parse((await message)[0]).type, expected);
  }
  const serverClosed = once([...probe.sockets.clients][0], 'close');
  const closed = once(ws, 'close'); probe.stop();
  assert.equal((await closed)[0], 1012);
  await serverClosed;
  assert.ok(logs.some(event => event.event === 'close' && event.durationMs >= 0));
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-a|synthetic-b|cookie/i);
});
