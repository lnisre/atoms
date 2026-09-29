import{createRequire}from'node:module';import{readFileSync,writeFileSync}from'node:fs';
const require=createRequire(process.cwd()+'/package.json');const{chromium,expect}=require('@playwright/test');
const html=readFileSync('tests/browser/preview-document.spec.ts','utf8').match(/const html = `([\s\S]*?)`;/)[1].replace('${prefix}','<!-- example <head> -->');
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{for(let i=0;i<10;i++){
 const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(10000);
 await page.route('**/api/generate',route=>route.fulfill({json:{html,model:'controlled-click-probe',durationMs:1,generatedAt:String(i)}}));
 await page.goto('https://v0-test0-nine.vercel.app');await page.getByLabel('你想做什么？').fill('平台装配回归');await page.getByRole('button',{name:'开始生成'}).click();const f=page.frameLocator('iframe');await expect(f.locator('#action')).toBeEnabled();
 const initial=await f.locator('body').evaluate(()=>({bridge:window.bridgeAtFirstScript,csp:document.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,first:document.head.firstElementChild?.tagName,headAttribute:document.head.getAttribute('data-example')}));
 await f.locator('body').evaluate(async()=>{try{await fetch('https://example.com/blocked-by-platform');return false;}catch{return true;}});
 // Add passive observation after normal test setup, without changing app handlers.
 const probe=()=>{window.reviewEvents=[];for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])addEventListener(type,e=>window.reviewEvents.push({type,target:e.target.tagName,id:e.target.id,inert:document.body.inert,time:performance.now()}),{capture:true,passive:true});};
 await page.evaluate(probe);await f.locator('body').evaluate(probe);
 await f.locator('#action').click();let passed=true;try{await expect(f.locator('#action')).toHaveText('1',{timeout:1500})}catch{passed=false;}
 const row={i,initial,passed,parentEvents:await page.evaluate(()=>window.reviewEvents),frameEvents:await f.locator('body').evaluate(()=>window.reviewEvents),status:await page.locator('.data-status').textContent(),button:await f.locator('#action').textContent(),inert:await f.locator('body').evaluate(el=>el.inert)};
 if(!passed){await page.screenshot({path:`/tmp/atoms-m2-rereview/click-probe-${i}.png`,fullPage:true});await f.locator('#action').click();try{await expect(f.locator('#action')).toHaveText('1',{timeout:3000});row.secondClickWorked=true;}catch{row.secondClickWorked=false;}}
 results.push(row);console.log(JSON.stringify(row));await context.close();if(results.filter(r=>!r.passed).length>=2)break;
}}finally{writeFileSync('/tmp/atoms-m2-rereview/click-probe.json',JSON.stringify(results,null,2));await browser.close();}
