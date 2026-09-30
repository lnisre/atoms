import { chromium } from '../../../../node_modules/@playwright/test/index.mjs';
import { writeFileSync } from 'node:fs';
const context = await chromium.launchPersistentContext('/private/tmp/atoms-m1-save-fix-before/browser-profile', { channel: 'chrome', headless: true });
try {
 const page=await context.newPage(); await page.goto('https://v0-test0-nine.vercel.app');
 await page.getByRole('region',{name:'已有项目'}).getByRole('button',{name:/M1 修复前复现/}).click();
 await page.frameLocator('iframe').getByLabel('新任务描述').waitFor();
 const baseline = await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
   const id=new URLSearchParams(location.search).get('project');
   const read=store=>new Promise(resolve=>{db.transaction(store).objectStore(store).get(id).onsuccess=e=>resolve(e.target.result);});
   const project=await read('projects'), data=await read('applicationData');db.close();return {project,data};
 });
 writeFileSync('docs/verification/assets/issue-5/before.json',JSON.stringify(baseline,null,2));
 console.log(JSON.stringify({url:page.url(),title:baseline.project.title,state:baseline.data.state}));
} finally {await context.close();}
