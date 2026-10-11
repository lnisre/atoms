// Management operation only. Never import this module into application runtime.
// Default is read-only; --enable-email applies the narrow, printed plan.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, createHmac } from 'node:crypto';
const args=process.argv.slice(2), credentials=args[args.indexOf('--credentials')+1], envId=args[args.indexOf('--env')+1];
if(!args.includes('--credentials')||!args.includes('--env')||!credentials||!envId||!/^[a-z\d-]+$/.test(envId)) {
  console.error('Usage: node scripts/cloudbase/email-auth.mjs --credentials ABSOLUTE_DOTENV --env ENV_ID [--enable-email]');process.exit(1);
}
const config=parseEnv(readFileSync(credentials,'utf8'));
const secretId=config.TENCENTCLOUD_SECRETID?.trim(), secretKey=config.TENCENTCLOUD_SECRETKEY?.trim();
if(!secretId||!secretKey)throw new Error('Missing management credentials');
if(config.TENCENTCLOUD_ENVID && config.TENCENTCLOUD_ENVID!==envId)throw new Error('Credential environment does not match requested environment');
const hash=s=>createHash('sha256').update(s).digest('hex');
const hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
async function call(action,fields={}) {
  const body=JSON.stringify({EnvId:envId,...fields}), host='tcb.tencentcloudapi.com', service='tcb', ts=Math.floor(Date.now()/1000), date=new Date(ts*1000).toISOString().slice(0,10);
  const type='application/json; charset=utf-8', signed='content-type;host', scope=`${date}/${service}/tc3_request`;
  const canonical=`POST\n/\n\ncontent-type:${type}\nhost:${host}\n\n${signed}\n${hash(body)}`;
  const signing=hmac(hmac(hmac('TC3'+secretKey,date),service),'tc3_request');
  const signature=createHmac('sha256',signing).update(`TC3-HMAC-SHA256\n${ts}\n${scope}\n${hash(canonical)}`).digest('hex');
  const response=await fetch('https://'+host,{method:'POST',headers:{'Content-Type':type,'X-TC-Action':action,'X-TC-Version':'2018-06-08','X-TC-Region':'ap-shanghai','X-TC-Timestamp':String(ts),Authorization:`TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,...(config.TENCENTCLOUD_SESSIONTOKEN?{'X-TC-Token':config.TENCENTCLOUD_SESSIONTOKEN}:{})},body,signal:AbortSignal.timeout(30000)});
  const data=(await response.json()).Response;
  console.log(JSON.stringify({action,status:response.status,requestId:data?.RequestId,errorCode:data?.Error?.Code}));
  if(!response.ok||data?.Error||!data?.RequestId)throw new Error('CloudBase management request failed; see safe status above');
  return data;
}
async function inspect() {
  const login=await call('DescribeLoginConfig');const providers=await call('GetProviders');const email=providers.Data?.find(p=>p.Id==='email');
  console.log(JSON.stringify({envId,region:'ap-shanghai',emailLogin:login.EmailLogin,usernameLogin:login.UserNameLogin,anonymousLogin:login.AnonymousLogin,phoneLogin:login.PhoneNumberLogin,emailProvider:email?.On,platformEmail:email?.EmailConfig?.On}));
  return {login,email};
}
async function main() {
  const {login,email}=await inspect();
  if(!args.includes('--enable-email'))return;
  if(!email)throw new Error('Email provider missing; refusing to create an unknown provider');
  console.log(JSON.stringify({plan:'Enable email OTP and platform email delivery only; preserve other login flags. No send, purchase, upgrade, billing, or domain changes.'}));
  try {
    await call('ModifyProvider',{Id:'email',On:'TRUE',EmailConfig:{On:'TRUE'}});
    await call('ModifyLoginConfig',{EmailLogin:true,AnonymousLogin:login.AnonymousLogin,UserNameLogin:login.UserNameLogin,PhoneNumberLogin:login.PhoneNumberLogin});
  } finally { await inspect(); }
}
main().catch(()=>{console.error('Configuration operation failed. No provider bodies or credentials are logged; inspect current state before retry.');process.exitCode=1;});
