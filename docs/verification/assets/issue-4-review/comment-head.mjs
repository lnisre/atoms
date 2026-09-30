import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require=createRequire(process.cwd()+'/package.json');
require('tsx/cjs');
const {POST}=require(process.cwd()+'/src/app/api/generate/route.ts');
const {chromium,expect}=require('@playwright/test');
const original='<!DOCTYPE html><html><head><title>Original</title></head><body><h1>原应用</h1><script>atoms.loadState().then(()=>{});</script></body></html>';
const html='<!DOCTYPE html><!-- example <head> --><html><head><title>Candidate</title></head><body><h1>候选注释边界</h1><button disabled id="action">添加任务</button><script>atoms.loadState().then(()=>document.getElementById("action").disabled=false);</script></body></html>';
process.env.DEEPSEEK_API_KEY='controlled-test-key';
const actualFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({model:'fixture',choices:[{finish_reason:'stop',message:{content:html}}]});
const result=await POST(new Request('http://localhost/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requirement:'测试待办',modification:'调整标题',baseHtml:original,context:[]})}));
const response=await result.json();globalThis.fetch=actualFetch;delete process.env.DEEPSEEK_API_KEY;
const checks={mode:'controlled model output; no real model call',serverStatus:result.status,htmlAcceptedUnchanged:response.html===html};
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(15000);let n=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.route('**/api/generate',route=>route.fulfill({json:{html:++n===1?original:html,model:'controlled-fixture',durationMs:1,generatedAt:String(n)}}));
 await page.goto('http://127.0.0.1:3107');await page.getByLabel('你想做什么？').fill('注释边界独立评审');await page.getByRole('button',{name:'开始生成'}).click();await expect(page.getByText('应用数据已读取 · 尚无已保存数据',{exact:true})).toBeVisible();
 await page.getByLabel('追加修改需求').fill('调整标题');await page.getByRole('button',{name:'生成候选',exact:true}).click();const f=page.frameLocator('iframe');await expect(f.getByRole('heading',{name:'候选注释边界'})).toBeVisible();
 checks.runtime=await f.locator('body').evaluate(()=>({atomsType:typeof window.atoms,scriptCount:document.scripts.length,cspCount:document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,actionDisabled:document.querySelector('button').disabled}));
 checks.pageErrors=errors;checks.platformStorage=await page.locator('.data-status').textContent();checks.platformPreviewError=await page.locator('.preview-error').count();checks.adoptEnabled=await page.getByRole('button',{name:'采用修改',exact:true}).isEnabled();
 await page.screenshot({path:'/tmp/atoms-m2-review/comment-head.png',fullPage:true});console.log(JSON.stringify(checks,null,2));
}finally{writeFileSync('/tmp/atoms-m2-review/comment-head.json',JSON.stringify(checks,null,2));await browser.close();}
