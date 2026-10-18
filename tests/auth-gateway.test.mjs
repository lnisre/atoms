import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import net from "node:net";
import { randomInt } from "node:crypto";

async function freeGatewayPorts() {
  // The gateway and its internal server need a consecutive pair. Stay below the
  // OS ephemeral range so outgoing connections cannot immediately consume it.
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = randomInt(20000, 40000), reserved = [];
    try {
      for (const candidate of [port, port + 1]) {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.once("error", reject); server.listen(candidate, "0.0.0.0", resolve); });
        reserved.push(server);
      }
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
    finally { await Promise.all(reserved.map(server => new Promise(resolve => server.close(resolve)))); }
  }
  throw new Error("No free gateway/internal-server port pair");
}

for (const [deployed,maintenance] of [[false,false],[true,false],[true,true]]) test(`real gateway ${deployed ? "deployment origin" : "local origin"}${maintenance ? " maintenance" : ""} rejects invalid upgrades and preserves permitted routes`, async () => {
  const port = await freeGatewayPorts();
  const dir=await mkdtemp(join(tmpdir(),"atoms-auth-gateway-"));
  const entry=join(dir,"server.mjs");
  await writeFile(entry, `import http from 'node:http';
http.createServer((req,res)=>{
 if(req.url==='/api/auth/session'){res.writeHead(req.headers.cookie==='synthetic=session'?200:401,{'Content-Type':'application/json'});res.end('{}');return}
 if(req.url==='/api/generate'){
  const valid=req.headers.cookie==='synthetic=session'&&req.headers['x-atoms-internal']===process.env.ATOMS_INTERNAL_KEY;
  res.writeHead(valid?200:401,{'Content-Type':valid?'application/x-ndjson':'application/json'});
  res.end(valid?'\\n \\n'+JSON.stringify({type:'result',synthetic:true})+'\\n\\n':'{}');return
 }
 if(req.url==='/cookies'){res.setHeader('Set-Cookie',['synthetic_a=1; HttpOnly','synthetic_b=2; HttpOnly']);res.end('cookies');return}
 res.end('ready');
}).listen(Number(process.env.PORT),'127.0.0.1');`);
  const child=spawn(process.execPath,["runtime/team/gateway.mjs"],{env:{...process.env,PORT:String(port),ATOMS_NEXT_ENTRY:entry,ATOMS_APP_ORIGIN:"",ATOMS_MAINTENANCE:maintenance?'1':'0',VERCEL_URL:deployed?"atoms-acceptance.vercel.app":""},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
  const connect=(cookie,origin=deployed?"https://atoms-acceptance.vercel.app":`http://localhost:${port}`)=>new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}/api/team/socket`,{headers:{host:`localhost:${port}`,origin,cookie}});
    const timer=setTimeout(()=>{ws.terminate();reject(new Error('gateway timeout'));},10000);
    ws.on('unexpected-response',(_req,res)=>{clearTimeout(timer);res.resume();resolve(res.statusCode);});
    ws.on('open',()=>ws.send(JSON.stringify({action:'start',ticket:{synthetic:true}})));
    ws.on('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));ws.close();});
    ws.on('error',error=>{clearTimeout(timer);reject(error);});
  });
  try {
    for(let i=0;i<100&&!output.includes('Team gateway listening');i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.match(output,/Team gateway listening/);
    const health=await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');
    const status=await health.json();assert.equal(status.nextReady,true);assert.equal(status.activeConnections,0);
    assert.equal(status.maintenance,maintenance);
    assert.equal((await fetch(`http://127.0.0.1:${port}/cookies`)).headers.getSetCookie().length,2);
    assert.equal(await connect('synthetic=session','https://evil.invalid'),403);
    if(maintenance){
      const start=await fetch(`http://127.0.0.1:${port}/api/generate?existing-page=1`,{method:'POST'});
      assert.equal(start.status,503);assert.equal(start.headers.get('cache-control'),'no-store');
      assert.equal((await start.json()).code,'maintenance');
      assert.equal(await connect('synthetic=session'),503);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/projects`,{method:'POST'})).status,200);
    }else{
      assert.equal(await connect(''),401);
      assert.equal(await connect('atoms-session=forged'),401);
      assert.deepEqual(await connect('synthetic=session'),{type:'result',synthetic:true});
    }
  } finally { child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',()=>resolve()));await rm(dir,{recursive:true,force:true}); }
});

test('gateway terminates only its owned Next process group and all descendants within a bounded shutdown', async () => {
  const port=await freeGatewayPorts(),dir=await mkdtemp(join(tmpdir(),'atoms-process-group-'));
  const entry=join(dir,'server.mjs');
  await writeFile(entry,`import http from 'node:http';import {spawn} from 'node:child_process';
const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
process.on('SIGTERM',()=>{});
http.createServer((req,res)=>res.end(req.url==='/descendant'?String(descendant.pid):'ready')).listen(Number(process.env.PORT),'127.0.0.1');`);
  const child=spawn(process.execPath,['runtime/team/gateway.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),ATOMS_NEXT_ENTRY:entry,ATOMS_APP_ORIGIN:'',VERCEL_URL:''},stdio:['ignore','pipe','pipe']});
  let output='',pid;child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
  const alive=id=>{try{process.kill(id,0);return true}catch(error){if(error.code==='ESRCH')return false;throw error}};
  try{
    for(let i=0;i<100&&!output.includes('Team gateway listening');i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.match(output,/Team gateway listening/);
    pid=Number(await fetch(`http://127.0.0.1:${port}/descendant`).then(response=>response.text()));assert.ok(alive(pid));
    const began=Date.now(),exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;
    assert.ok(Date.now()-began<4500,'shutdown exceeded bound');
    for(let i=0;i<40&&alive(pid);i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(alive(pid),false,'orphaned task subprocess');
    assert.equal(alive(process.pid),true,'test process is outside the owned group');
    assert.match(output,/"reason":"SIGTERM"/);
  }finally{if(child.exitCode===null)child.kill('SIGKILL');if(pid&&alive(pid))process.kill(pid,'SIGKILL');await rm(dir,{recursive:true,force:true})}
});

test('production without a configured trusted origin fails before starting Next', async () => {
  const child=spawn(process.execPath,['runtime/team/gateway.mjs'],{env:{...process.env,NODE_ENV:'production',ATOMS_APP_ORIGIN:'',VERCEL_URL:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',chunk=>{output+=chunk});
  const code=await new Promise(resolve=>child.once('exit',resolve));
  assert.equal(code,1);assert.match(output,/exact trusted origin/);
});
