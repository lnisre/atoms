import { chromium, expect } from '../../../../node_modules/@playwright/test/index.mjs';
import { writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out='docs/verification/assets/issue-11';
const profile='/private/tmp/atoms-issue-11-reading-20260930';
const url='https://v0-test0-nine.vercel.app/';
const calls=[], requests=[], messages=[], errors=[];
let phase='initial', context, page;
const save=(name,value)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2));
const hash=value=>createHash('sha256').update(value).digest('hex');
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:900}});
 await context.exposeBinding('recordMessage',(_,data)=>messages.push({phase,...data}));
 await context.addInitScript(()=>{if(window===window.top)window.addEventListener('message',e=>{if(e.data && typeof e.data==='object')window.recordMessage({time:Date.now(),type:e.data.type,method:e.data.method,action:e.data.action,operation:e.data.operation,ok:e.data.ok});});});
 context.on('request',r=>{if(r.url().startsWith('https://v0-test0-nine.vercel.app'))requests.push({phase,time:Date.now(),method:r.method(),url:r.url()});});
 page=context.pages()[0]||await context.newPage();
 page.on('pageerror',e=>errors.push({phase,message:e.message}));
 await page.goto(url); await page.getByLabel('你想做什么？').waitFor();
}
async function snapshot(){return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
 const id=new URLSearchParams(location.search).get('project');
 const read=store=>new Promise(resolve=>{db.transaction(store).objectStore(store).get(id).onsuccess=e=>resolve(e.target.result);});
 const project=await read('projects'),data=await read('applicationData');db.close();return {project,data};
});}
async function capture(name){
 await page.screenshot({path:`${out}/${name}.png`,fullPage:true});
 const snap=await snapshot();
 save(name,{phase,url:page.url(),viewport:page.viewportSize(),outer:await page.locator('body').innerText(),inner:await page.frameLocator('iframe').locator('body').innerText(),...snap});
 save('network',requests);save('messages',messages);save('errors',errors);
 return {url:page.url(),data:snap.data,inner:await page.frameLocator('iframe').locator('body').innerText()};
}
async function generate(requirement,modify=false){
 const n=calls.length+1;
 await page.getByLabel(modify?'追加修改需求':'你想做什么？').fill(requirement);
 const started=Date.now();const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/generate'),{timeout:180000});
 await page.getByRole('button',{name:modify?'生成候选':'开始生成',exact:true}).click();
 const response=await responsePromise;const result=await response.json();
 const call={n,phase,requirement,status:response.status(),wallMs:Date.now()-started,...result};
 save(`call-${n}`,{...call,request:response.request().postDataJSON()});
 if(result.html)writeFileSync(`${out}/model-${n}.html`,result.html);
 calls.push({...call,html:result.html?{sha256:hash(result.html),bytes:Buffer.byteLength(result.html)}:undefined});save('calls',calls);
 assert(response.ok(),JSON.stringify(result));
 await page.frameLocator('iframe').locator('body').waitFor();
 return capture(`generated-${n}`);
}
await launch();
await page.screenshot({path:`${out}/home.png`});
console.log('READY '+await page.locator('body').innerText());
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const command of rl){
 if(command==='EXIT')break;
 appendFileSync(`${out}/commands.log`,command+'\n');
 try{const value=await eval(command);if(value!==undefined)console.log(value);console.log('DONE');}
 catch(error){console.log('ERROR '+error.stack);appendFileSync(`${out}/failures.log`,new Date().toISOString()+' '+error.stack+'\n');}
 save('network',requests);save('messages',messages);save('errors',errors);
}
await context.close();
