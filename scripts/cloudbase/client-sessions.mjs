// Management operation only. Never import this module into application runtime.
// Default is read-only; --max-devices N --apply changes only the approved session limit.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash, createHmac } from 'node:crypto';
const args=process.argv.slice(2), credentials=args[args.indexOf('--credentials')+1], envId=args[args.indexOf('--env')+1];
if(!args.includes('--credentials')||!args.includes('--env')||!credentials||!envId||!/^[a-z\d-]+$/.test(envId)) {
  console.error('Usage: node scripts/cloudbase/client-sessions.mjs --credentials ABSOLUTE_DOTENV --env ENV_ID [--max-devices N --apply]');process.exit(1);
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
const flag=args.indexOf('--max-devices');
const max=flag<0?undefined:Number(args[flag+1]);
if(flag>=0&&(!Number.isInteger(max)||max<1||max>50))throw Error('MaxDevice must be 1..50');
if(args.includes('--apply')&&max===undefined)throw Error('--apply requires --max-devices');
const projection=p=>({clientId:p.Id,accessTokenExpiresIn:p.AccessTokenExpiresIn,refreshTokenExpiresIn:p.RefreshTokenExpiresIn,maxDevice:p.MaxDevice});
async function main(){
 const before=await call('DescribeClient',{Id:envId});console.log(JSON.stringify({before:projection(before)}));
 if(!args.includes('--apply'))return;
 console.log(JSON.stringify({plan:{clientId:envId,MaxDevice:max,otherFields:'unchanged'}}));
 await call('ModifyClient',{Id:envId,MaxDevice:max});
 const after=await call('DescribeClient',{Id:envId});console.log(JSON.stringify({after:projection(after)}));
 if(after.MaxDevice!==max||after.AccessTokenExpiresIn!==before.AccessTokenExpiresIn||after.RefreshTokenExpiresIn!==before.RefreshTokenExpiresIn)throw Error('Session configuration readback mismatch');
}
main().catch(()=>{console.error('Session configuration failed; inspect safe status and read back before retry.');process.exitCode=1;});
