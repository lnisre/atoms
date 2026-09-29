import {chromium,expect} from '../../../../node_modules/@playwright/test/index.mjs';
import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const out='docs/verification/assets/m1-save-fix';const context=await chromium.launchPersistentContext('/private/tmp/atoms-m1-save-fix-live',{channel:'chrome',headless:true});
try{
 const page=await context.newPage();let calls=0;page.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++;});await page.goto('https://v0-test0-nine.vercel.app');
 const requirement='做一个支持添加、完成、删除任务的待办应用。中文界面，清楚区分已完成和未完成任务，适配手机。';await page.getByLabel('你想做什么？').fill(requirement);const response=page.waitForResponse(r=>r.url().endsWith('/api/generate'),{timeout:150000});await page.getByRole('button',{name:'开始生成'}).click();const r=await response;const data=await r.json();if(!r.ok())throw new Error(JSON.stringify(data));
 writeFileSync(out+'/new-production-todo.html',data.html);const hash=createHash('sha256').update(data.html).digest('hex');await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();await expect(page.locator('iframe')).toBeVisible();const meta={requirement,model:data.model,durationMs:data.durationMs,generatedAt:data.generatedAt,htmlSha256:hash,generationRequests:calls,url:page.url()};writeFileSync(out+'/new-generation.json',JSON.stringify(meta,null,2));await page.screenshot({path:out+'/new-generated.png',fullPage:true});console.log(meta);
}finally{await context.close();}
