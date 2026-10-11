// Management only: never imported by the web application. No raw responses,
// credentials, SQL, or application data are logged by this helper.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, createHmac } from 'node:crypto';
export function managementSql(credentials, envId) {
  if (!/^[a-z\d-]+$/.test(envId)) throw new Error('Invalid environment');
  const config = parseEnv(readFileSync(credentials, 'utf8'));
  const secretId = config.TENCENTCLOUD_SECRETID?.trim(), secretKey = config.TENCENTCLOUD_SECRETKEY?.trim();
  if (!secretId || !secretKey) throw new Error('Missing management credentials');
  if (config.TENCENTCLOUD_ENVID && config.TENCENTCLOUD_ENVID !== envId) throw new Error('Environment mismatch');
  const hash = s => createHash('sha256').update(s).digest('hex');
  const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
  return async function sql(Sql) {
    const body = JSON.stringify({ EnvId: envId, Sql }), host = 'tcb.tencentcloudapi.com', ts = Math.floor(Date.now() / 1000), date = new Date(ts * 1000).toISOString().slice(0, 10);
    const type = 'application/json; charset=utf-8', signed = 'content-type;host', scope = `${date}/tcb/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:${type}\nhost:${host}\n\n${signed}\n${hash(body)}`;
    const signature = createHmac('sha256', hmac(hmac(hmac('TC3' + secretKey, date), 'tcb'), 'tc3_request')).update(`TC3-HMAC-SHA256\n${ts}\n${scope}\n${hash(canonical)}`).digest('hex');
    const response = await fetch('https://' + host, { method: 'POST', headers: {
      'Content-Type': type, 'X-TC-Action': 'ExecutePGSql', 'X-TC-Version': '2018-06-08', 'X-TC-Region': 'ap-shanghai', 'X-TC-Timestamp': String(ts),
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      ...(config.TENCENTCLOUD_SESSIONTOKEN ? { 'X-TC-Token': config.TENCENTCLOUD_SESSIONTOKEN } : {}),
    }, body, signal: AbortSignal.timeout(30_000) });
    const data = (await response.json()).Response;
    const summary = { requestId: data?.RequestId, status: response.status, errorCode: data?.Error?.Code,
      sqlState: data?.Error?.Message?.match(/SQLSTATE[: ]+([A-Z0-9]{5})/)?.[1] };
    if (!response.ok || data?.Error || !data?.RequestId) {
      const error = new Error('PG management request failed'); error.summary = summary; throw error;
    }
    return { summary, rows: (data.Rows ?? []).map(row => JSON.parse(row)), affectedRows: data.AffectedRows };
  };
}
export function sqlLiteral(value) { return "'" + value.replaceAll("'", "''") + "'"; }
export function managementArgs() {
  const args = process.argv.slice(2);
  const credentials = args.includes('--credentials') ? args[args.indexOf('--credentials') + 1] : undefined;
  const envId = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;
  if (!credentials || !envId) throw new Error('Requires --credentials DOTENV --env ENV_ID');
  return { credentials, envId, apply: args.includes('--apply') };
}
