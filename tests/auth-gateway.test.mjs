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

for (const deployed of [false,true]) test(`real gateway ${deployed ? "deployment origin" : "local origin"} rejects anonymous/invalid upgrades and forwards the verified cookie`, async () => {
  const port = await freeGatewayPorts();
  const dir=await mkdtemp(join(tmpdir(),"atoms-auth-gateway-"));
  const entry=join(dir,"server.mjs");
  await writeFile(entry, `import http from 'node:http';
http.createServer((req,res)=>{
 if(req.url==='/api/auth/session'){res.writeHead(req.headers.cookie==='synthetic=session'?200:401,{'Content-Type':'application/json'});res.end('{}');return}
 if(req.url==='/api/generate'){
  const valid=req.headers.cookie==='synthetic=session'&&req.headers['x-atoms-internal']===process.env.ATOMS_INTERNAL_KEY;
  res.writeHead(valid?200:401,{'Content-Type':valid?'application/x-ndjson':'application/json'});
  res.end(valid?JSON.stringify({type:'result',synthetic:true})+'\\n':'{}');return
 }
 res.end('ready');
}).listen(Number(process.env.PORT),'127.0.0.1');`);
  const child=spawn(process.execPath,["runtime/team/gateway.mjs"],{env:{...process.env,PORT:String(port),ATOMS_NEXT_ENTRY:entry,ATOMS_APP_ORIGIN:"",VERCEL_URL:deployed?"atoms-acceptance.vercel.app":""},stdio:["ignore","pipe","pipe"]});
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
    assert.equal(await connect(''),401);
    assert.equal(await connect('atoms-session=forged'),401);
    assert.equal(await connect('synthetic=session','https://evil.invalid'),403);
    assert.deepEqual(await connect('synthetic=session'),{type:'result',synthetic:true});
  } finally { child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',()=>resolve()));await rm(dir,{recursive:true,force:true}); }
});
