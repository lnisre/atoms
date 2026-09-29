import {chromium,expect} from '../../../../node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const html=readFileSync('tests/browser/persistence.spec.ts','utf8').match(/const html = `([\s\S]*?)`;/)[1];
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
for(let i=0;i<10;i++){
 const context=await browser.newContext();await context.addInitScript(()=>{window.events=[];for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','input'])addEventListener(type,e=>window.events.push({type,target:e.target.outerHTML?.slice(0,200),x:e.clientX,y:e.clientY,inert:document.body?.inert,time:performance.now()}),true);});
 const page=await context.newPage();await page.route('**/api/generate',r=>r.fulfill({json:{html,model:'fixture',durationMs:1,generatedAt:'test'}}));await page.goto('http://127.0.0.1:3101');await page.getByLabel('你想做什么？').fill('诊断首次点击');await page.getByRole('button',{name:'开始生成'}).click();await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();const f=page.frameLocator('iframe');await expect(f.getByLabel('任务',{exact:true})).toBeEnabled();await f.getByLabel('任务',{exact:true}).fill('诊断');const box=await f.getByRole('button',{name:'添加',exact:true}).boundingBox();await f.getByRole('button',{name:'添加',exact:true}).click();
 let ok=true;try{await expect(f.locator('li')).toHaveCount(1,{timeout:1500});}catch{ok=false;}
 const frames=await Promise.all(page.frames().map(async fr=>({url:fr.url(),events:await fr.evaluate(()=>window.events)})));results.push({i,ok,box,frames});await context.close();if(!ok)break;
}
await browser.close();writeFileSync('docs/verification/assets/m1-save-fix/click-diagnostic.json',JSON.stringify(results,null,2));console.log(results.map(r=>({i:r.i,ok:r.ok})));
