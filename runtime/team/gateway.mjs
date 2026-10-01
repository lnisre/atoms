// One WebSocket pins all task traffic to this container. HTTP is proxied to the
// local Next process; task capabilities never travel through a public callback.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
const port=Number(process.env.PORT||3105), internalPort=port+1;
const internalKey=randomBytes(32).toString('hex');
const origin=`http://localhost:${internalPort}`;
const transportOrigin=`http://127.0.0.1:${internalPort}`;
const child=spawn(process.execPath,[process.env.ATOMS_NEXT_ENTRY||'.next/standalone/server.js'],{stdio:'inherit',env:{...process.env,PORT:String(internalPort),HOSTNAME:'127.0.0.1',ATOMS_INTERNAL_KEY:internalKey}});
const server=http.createServer((req,res)=>{
  const expectedOrigin=`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;
  if(req.headers.origin && req.headers.origin!==expectedOrigin){res.writeHead(403);res.end('Forbidden origin');return}
  const headers={...req.headers,host:`localhost:${internalPort}`,'x-forwarded-host':`localhost:${internalPort}`,'x-forwarded-proto':'http'};
  if(headers.origin)headers.origin=origin;
  delete headers['x-atoms-internal'];
  const upstream=http.request(transportOrigin+req.url,{method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Application is starting')});
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
});
const sockets=new WebSocketServer({noServer:true,maxPayload:3_000_000});
server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url,'http://localhost');
  const expectedOrigin=`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`;
  if(url.pathname!=='/api/team/socket'||req.headers.origin!==expectedOrigin){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
});
sockets.on('connection',ws=>{
  const abort=new AbortController();let started=false;let taskId,token;let bytes=0;
  const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value))};
  const post=(endpoint,body)=>fetch(transportOrigin+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Atoms-Internal':internalKey,'X-Atoms-Protocol':'atoms-team/2'},body:JSON.stringify(body),signal:abort.signal});
  const startTimer=setTimeout(()=>ws.close(1008,'start required'),5000);
  ws.on('close',()=>{clearTimeout(startTimer);if(taskId&&token){void fetch(transportOrigin+'/api/team',{method:'POST',headers:{'Content-Type':'application/json','X-Atoms-Internal':internalKey},body:JSON.stringify({action:'cancel',taskId,token}),signal:AbortSignal.timeout(1500)}).then(r=>r.body?.cancel()).catch(()=>{});}abort.abort()});ws.on('error',()=>abort.abort());
  ws.on('message',async raw=>{
    try{
      bytes+=raw.length;if(bytes>4_000_000)throw new Error('control output too large');
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
// Wait for Next before advertising container readiness.
let ready=false;
for(let i=0;i<120;i++){
  try{const r=await fetch(transportOrigin+'/',{method:'HEAD',signal:AbortSignal.timeout(1000)});if(r.status<500){ready=true;break}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
}
if(!ready){console.error('Internal Next server did not become ready');child.kill();process.exit(1)}
server.listen(port,'0.0.0.0',()=>console.log(`Team gateway listening on ${port}`));
child.on('exit',code=>{server.close();process.exit(code??1)});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const ws of sockets.clients)ws.terminate();child.kill(signal);server.close()});
