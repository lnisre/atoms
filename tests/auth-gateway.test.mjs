import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import net from "node:net";

test("real gateway rejects anonymous/invalid socket upgrades and forwards the verified cookie to internal start", async () => {
  const port = await new Promise(resolve => { const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const address=s.address();if (!address || typeof address === "string")throw new Error();const p=address.port;s.close(()=>resolve(p));}); });
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
  const child=spawn(process.execPath,["runtime/team/gateway.mjs"],{env:{...process.env,PORT:String(port),ATOMS_NEXT_ENTRY:entry},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
  const connect=(cookie,origin=`http://localhost:${port}`)=>new Promise((resolve,reject)=>{
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
