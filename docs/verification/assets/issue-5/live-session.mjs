import { chromium, expect } from '../../../../node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const out=process.env.ISSUE5_EVIDENCE_DIR || 'docs/verification/assets/issue-5';
const baseline=JSON.parse(readFileSync(out+'/before.json','utf8'));
const profile=process.env.ISSUE5_BROWSER_PROFILE || '/private/tmp/atoms-m1-save-fix-before/browser-profile';
let context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});
let page=await context.newPage();
const url='https://v0-test0-nine.vercel.app/?project='+baseline.project.id;
let round=0;
const calls=[];
async function snapshot(target=page) {
 return target.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
  const id=new URLSearchParams(location.search).get('project');
  const read=store=>new Promise(resolve=>{db.transaction(store).objectStore(store).get(id).onsuccess=e=>resolve(e.target.result);});
  const project=await read('projects'),data=await read('applicationData');db.close();return {project,data};
 });
}
async function intact(target=page) {
 assert.deepEqual(await snapshot(target),baseline);
 return true;
}
async function modify(text) {
 const n=++round;
 await page.getByLabel('追加修改需求').fill(text);
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/generate'),{timeout:160000});
 await page.getByRole('button',{name:'生成候选',exact:true}).click();
 const response=await responsePromise;
 const input=response.request().postDataJSON();
 const result=await response.json();
 calls.push({round:n,modification:text,status:response.status(),model:result.model,durationMs:result.durationMs,generatedAt:result.generatedAt,context:input.context,baseEqualsPrevious:n===1?input.baseHtml===baseline.project.result.html:input.baseHtml===readFileSync(out+`/candidate-${n-1}.html`,'utf8')});
 writeFileSync(out+'/calls.json',JSON.stringify(calls,null,2));
 if(!response.ok())throw new Error(result.error);
 writeFileSync(out+`/candidate-${n}.html`,result.html);
 await expect(page.locator('.preview-toolbar')).toContainText('候选试用');
 await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeDisabled();
 await page.frameLocator('iframe').locator('body').waitFor();
 console.log(JSON.stringify({call:calls.at(-1),dom:await page.frameLocator('iframe').locator('body').innerText()}));
 await intact();
}
await page.goto(url);
await expect(page.getByLabel('追加修改需求')).toBeVisible();
await intact();
console.log('READY '+url);
const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const command of rl) {
 if(command==='EXIT')break;
 appendFileSync(out+'/live-commands.log',command+'\n');
 try {const value=await eval(command); if(value!==undefined)console.log(value);console.log('DONE');}
 catch(error){console.log('ERROR '+error.stack);}
}
rl.close();
await context.close();
