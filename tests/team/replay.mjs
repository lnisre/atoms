// Replays a selected synthetic proof without a model, Vercel or project storage.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('@playwright/test');
const esbuild=createRequire(require.resolve('tsx'))('esbuild');
const root=fileURLToPath(new URL('../../',import.meta.url));
const proofFile=path.resolve(process.argv[2]||'docs/verification/assets/issue-25/cloud-counter-1-failure.json');
const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
const html=typeof proof.request.html==='string' ? proof.request.html : fs.readFileSync(path.resolve(path.dirname(proofFile),proof.artifact),'utf8');
if(createHash('sha256').update(html).digest('hex')!==proof.request.codeHash)throw new Error('Artifact hash mismatch');
const bundle=await esbuild.build({entryPoints:[root+'/src/lib/qa/browser-tool.ts'],bundle:true,format:'iife',globalName:'QaReplay',platform:'browser',write:false});
const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head></head><body></body></html>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const browser=await chromium.launch({channel:'chrome',env});
let timer;
try{
  const page=await browser.newPage();
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.goto(origin);await page.addScriptTag({content:bundle.outputFiles[0].text});
  const request={...proof.request,html,taskId:randomUUID(),requestId:randomUUID(),deadline:Date.now()+30000};
  const result=await Promise.race([page.evaluate(async request=>{const host=document.createElement('div');document.body.append(host);try{return await QaReplay.runBrowserCheck(request,host,new AbortController().signal,()=>{})}finally{host.remove()}},request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Replay supervisor timeout')),45000)})]);
  const output={kind:'independent zero-model replay, not original task receipt',originalTaskId:proof.request.taskId,result};
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(output,null,2));
  console.log(JSON.stringify({status:result.status,passed:result.results.filter(r=>r.status==='passed').length,total:result.results.length,failedChecks:result.results.filter(r=>r.status!=='passed').map(r=>({scenarioId:r.scenarioId,checkId:r.checkId,expected:r.expected,actual:r.actual})),modelRequests:0},null,2));
  if(result.status!==proof.result.status)process.exitCode=1;
}finally{clearTimeout(timer);await browser.close();await new Promise(resolve=>server.close(resolve))}
