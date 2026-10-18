// One WebSocket pins all task traffic to this container. HTTP is proxied to the
// local Next process; task capabilities never travel through a public callback.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
const port=Number(process.env.PORT||3105), internalPort=port+1;
const internalKey=randomBytes(32).toString('hex');
if (!Number.isInteger(port) || port < 1 || port > 65534) throw new Error('Invalid gateway port');
// Isolated deployments use their trusted platform-assigned origin; production
// aliases still require an explicit ATOMS_APP_ORIGIN. Never derive this from input.
if (!process.env.ATOMS_APP_ORIGIN && process.env.VERCEL_URL) {
  if (!/^[a-z0-9][a-z0-9-]*\.vercel\.app$/i.test(process.env.VERCEL_URL)) throw new Error('Invalid deployment origin');
  process.env.ATOMS_APP_ORIGIN=`https://${process.env.VERCEL_URL}`;
}
if (process.env.ATOMS_APP_ORIGIN) {
  const configured=new URL(process.env.ATOMS_APP_ORIGIN);
  if(configured.origin!==process.env.ATOMS_APP_ORIGIN || configured.username || configured.password ||
    (configured.protocol!=='https:' && !(process.env.ATOMS_HOSTING!=='cloudbase' && configured.protocol==='http:' && ['localhost','127.0.0.1'].includes(configured.hostname)))) throw new Error('Invalid configured origin');
} else if(process.env.NODE_ENV==='production') throw new Error('Production requires an exact trusted origin');
let release={protocol:'atoms-team/3',sourceCommit:null,sourceDigest:null};
try {
  const value=JSON.parse(readFileSync(new URL('./release.json',import.meta.url),'utf8'));
  if(value.protocol!=='atoms-team/3'||!/^[a-f0-9]{40}$/.test(value.sourceCommit)||!/^[a-f0-9]{64}$/.test(value.sourceDigest))throw Error();
  release={protocol:value.protocol,sourceCommit:value.sourceCommit,sourceDigest:value.sourceDigest};
}catch{if(process.env.ATOMS_HOSTING==='cloudbase')throw new Error('Missing frozen release identity')}
let ready=false,stopping=false;
const started=Date.now();
const log=(event,details={})=>console.log(JSON.stringify({component:'atoms-gateway',event,...release,...details}));
const origin=`http://localhost:${internalPort}`;
const transportOrigin=`http://127.0.0.1:${internalPort}`;
// Own a distinct process group: every Python task inherits this group's id.
// Killing only Next can orphan Python when a platform stops an instance.
const child=spawn(process.execPath,[process.env.ATOMS_NEXT_ENTRY||'.next/standalone/server.js'],{detached:true,stdio:'inherit',env:{...process.env,PORT:String(internalPort),HOSTNAME:'127.0.0.1',ATOMS_INTERNAL_KEY:internalKey}});
const killOwnedGroup=signal=>{if(child.pid){try{process.kill(-child.pid,signal)}catch(error){if(error.code!=='ESRCH')log('group-stop-failed',{signal})}}};
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz'){
    let nextReady=false;
    if(ready&&!stopping&&child.exitCode===null){try{const r=await fetch(transportOrigin+'/',{method:'HEAD',signal:AbortSignal.timeout(1000)});await r.body?.cancel();nextReady=r.status<500}catch{}}
    res.writeHead(nextReady?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({status:nextReady?'ready':'unavailable',nextReady,...release,activeConnections:sockets.clients.size,uptimeMs:Date.now()-started,stopping}));return;
  }
  if(!ready||stopping){res.writeHead(503,{'Cache-Control':'no-store'});res.end('Application unavailable');return}
  const expectedOrigin=process.env.ATOMS_APP_ORIGIN||`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;
  if(req.headers.origin && req.headers.origin!==expectedOrigin){res.writeHead(403);res.end('Forbidden origin');return}
  const headers={...req.headers,host:`localhost:${internalPort}`,'x-forwarded-host':`localhost:${internalPort}`,'x-forwarded-proto':'http'};
  if(headers.origin && !process.env.ATOMS_APP_ORIGIN)headers.origin=origin;
  delete headers['x-atoms-internal'];
  const upstream=http.request(transportOrigin+req.url,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Application is starting')});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
});
const sockets=new WebSocketServer({noServer:true,maxPayload:8_000_000});
server.on('upgrade',async(req,socket,head)=>{
  if(!ready||stopping){socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return}
  const url=new URL(req.url,'http://localhost');
  const expectedOrigin=process.env.ATOMS_APP_ORIGIN||`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;
  if(url.pathname!=='/api/team/socket'||req.headers.origin!==expectedOrigin){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  try {
    const session = await fetch(transportOrigin+'/api/auth/session',{headers:{cookie:req.headers.cookie||''},signal:AbortSignal.timeout(15000)});
    await session.body?.cancel();
    if(!session.ok){socket.end(session.status===401||session.status===403?'HTTP/1.1 401 Unauthorized\r\n\r\n':'HTTP/1.1 503 Service Unavailable\r\n\r\n');return}
  } catch {socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return}
  if(socket.destroyed)return;
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws,req.headers.cookie||''));
});
sockets.on('connection',(ws,cookie)=>{
  const connected=Date.now();log('connection-open',{activeConnections:sockets.clients.size});
  const abort=new AbortController();let started=false;let taskId,token;let bytes=0;
  const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value))};
  const post=(endpoint,body)=>fetch(transportOrigin+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Atoms-Internal':internalKey,'X-Atoms-Protocol':'atoms-team/3','Cookie':cookie},body:JSON.stringify(body),signal:abort.signal});
  const startTimer=setTimeout(()=>ws.close(1008,'start required'),5000);
  ws.on('close',code=>{log('connection-close',{code,durationMs:Date.now()-connected,activeConnections:sockets.clients.size});clearTimeout(startTimer);if(taskId&&token){void fetch(transportOrigin+'/api/team',{method:'POST',headers:{'Content-Type':'application/json','X-Atoms-Internal':internalKey},body:JSON.stringify({action:'cancel',taskId,token}),signal:AbortSignal.timeout(1500)}).then(r=>r.body?.cancel()).catch(()=>{});}abort.abort()});ws.on('error',()=>abort.abort());
  ws.on('message',async raw=>{
    try{
      bytes+=raw.length;if(bytes>8_000_000)throw new Error('control output too large');
      const message=JSON.parse(raw.toString());
      if(message.action==='start'){
        if(started)throw new Error('already started');started=true;clearTimeout(startTimer);
        const response=await post('/api/generate',{ticket:message.ticket});
        if(!response.ok){send({type:'socket-error',error:(await response.json()).error||'团队启动失败'});ws.close(1000);return}
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let index;
          while((index=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='session'){taskId=event.taskId;token=event.token}send(event)}
          if(done)break;
        }if(buffer.trim())throw new Error('incomplete stream');}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
        ws.close(1000);
      }else{
        if(!started||!token||message.taskId!==taskId||message.token!==token)throw new Error('invalid owner');
        const response=await post('/api/team',message);
        const data=await response.json();send({type:'control-ack',id:message.id,ok:response.ok,error:data.error});
      }
    }catch{send({type:'socket-error',error:'团队连接或工具回传失败。'});ws.close(1011);abort.abort()}
  });
});
const shutdown=(reason,exitCode=0)=>{
  if(stopping)return;stopping=true;ready=false;
  log('shutdown',{reason,activeConnections:sockets.clients.size});
  for(const ws of sockets.clients)ws.terminate();
  server.close();server.closeAllConnections();killOwnedGroup('SIGTERM');
  // The platform need not grant eight minutes of drain time. Never leave a paid
  // process behind, and never pretend existing tasks can resume after restart.
  setTimeout(()=>{killOwnedGroup('SIGKILL');process.exit(exitCode)},2000);
};
child.on('error',()=>shutdown('next-spawn-failed',1));
child.on('exit',(code,signal)=>{killOwnedGroup('SIGKILL');shutdown(signal?'next-signal':'next-exit',stopping?0:(code||1))});
server.on('error',()=>shutdown('gateway-listen-failed',1));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>shutdown(signal));
// Wait for Next before advertising container readiness; fail within 30 seconds.
const readinessDeadline=Date.now()+30_000;
while(Date.now()<readinessDeadline){
  if(stopping)break;
  try{const r=await fetch(transportOrigin+'/',{method:'HEAD',signal:AbortSignal.timeout(Math.max(1,Math.min(1000,readinessDeadline-Date.now())))});await r.body?.cancel();if(r.status<500){ready=true;break}}catch{}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(250,readinessDeadline-Date.now()))));
}
if(!ready){shutdown('next-readiness-timeout',1)}
else if(!stopping)server.listen(port,'0.0.0.0',()=>{log('ready',{startupMs:Date.now()-started});console.log(`Team gateway listening on ${port}`)});
