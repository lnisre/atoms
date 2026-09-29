import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const root='/private/tmp/atoms-m1-review';
const html=readFileSync(root+'/snapshot/docs/verification/assets/issue-3/production-todo.html','utf8');
const url='https://v0-test0-nine.vercel.app';
const result={};
let context=await chromium.launchPersistentContext(root+'/browser-profile',{channel:'chrome',headless:true});
let page=await context.newPage(); let requests=0;
context.on('request',r=>{if(r.url().includes('/api/generate'))requests++});
await page.route('**/api/generate',r=>r.fulfill({json:{html,model:'replayed-real-artifact',durationMs:14788,generatedAt:new Date().toISOString()}}));
await page.goto(url);
await page.getByLabel('你想做什么？').fill('独立评审真实产物恢复');
await page.getByRole('button',{name:'开始生成'}).click();
let f=page.frameLocator('iframe');
await expect(f.getByLabel('新任务描述')).toBeEnabled();
async function add(text){await f.getByLabel('新任务描述').fill(text);await f.getByRole('button',{name:'添加',exact:true}).click();await expect(f.locator('#saveStatus')).toHaveText('已保存');}
await add('评审保留');await add('评审删除');
await f.getByRole('listitem').filter({hasText:'评审保留'}).getByRole('button',{name:'标记为已完成',exact:true}).click();
await expect(f.locator('#saveStatus')).toHaveText('已保存');
await f.getByRole('listitem').filter({hasText:'评审删除'}).getByRole('button',{name:'删除任务'}).click();
await expect(f.locator('#saveStatus')).toHaveText('已保存');
const projectUrl=page.url();await page.reload();
await expect(f.getByRole('listitem').filter({hasText:'评审保留'}).getByRole('button',{name:'标记为未完成',exact:true})).toBeVisible();await expect(f.getByText('评审删除',{exact:true})).toHaveCount(0);
result.normal={refresh:true,generationRequests:requests};await context.close();
context=await chromium.launchPersistentContext(root+'/browser-profile',{channel:'chrome',headless:true});page=await context.newPage();requests=0;context.on('request',r=>{if(r.url().includes('/api/generate'))requests++});
await page.goto(url);await page.getByRole('region',{name:'已有项目'}).getByRole('button',{name:/独立评审真实产物恢复/}).click();f=page.frameLocator('iframe');
await expect(f.getByRole('button',{name:'标记为未完成',exact:true})).toBeVisible();await expect(f.getByText('评审删除',{exact:true})).toHaveCount(0);result.normal.fullBrowserRestart=true;result.normal.reopenGenerationRequests=requests;
// Slow the first business-data write transaction while retaining native completion semantics.
await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;let held=false;IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(args[1]==='readwrite'&&!held){held=true;const store=tx.objectStore('applicationData');const end=performance.now()+550;const pump=()=>{const req=store.get('__review_keepalive__');req.onsuccess=()=>{if(performance.now()<end)pump()};};pump();}return tx;};});
const child=page.frames().find(x=>x.parentFrame());
// Observe the first success immediately, before the generated app's deferred second save.
const captured=child.evaluate(()=>new Promise(resolve=>{const status=document.querySelector('#saveStatus');const observer=new MutationObserver(()=>{if(status.textContent==='已保存'){observer.disconnect();resolve({status:status.textContent,visible:document.querySelector('main').innerText,time:performance.now()});}});observer.observe(status,{childList:true,subtree:true,characterData:true});}));
await f.getByLabel('新任务描述').fill('快速第一条');await f.getByRole('button',{name:'添加',exact:true}).click();
await f.getByLabel('新任务描述').fill('快速第二条');await f.getByRole('button',{name:'添加',exact:true}).click();
const observation=await captured;
const stored=await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('atoms-projects',1);req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['applicationData'],'readonly');const q=tx.objectStore('applicationData').get(new URLSearchParams(location.search).get('project'));q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};req.onerror=()=>reject(req.error);}));
result.rapid={observation,storedAtSaved:stored,platformStatus:await page.locator('.data-status').innerText()};
await page.reload();await expect(f.getByLabel('新任务描述')).toBeEnabled();result.rapid.afterRefresh=await f.locator('main').innerText();
await page.screenshot({path:root+'/rapid-after-refresh.png',fullPage:true});
// Initial project save failure; restore storage capability and inspect available recovery controls.
await page.goto(url);await page.route('**/api/generate',r=>r.fulfill({json:{html,model:'replayed-real-artifact',durationMs:14788,generatedAt:new Date().toISOString()}}));
await page.evaluate(()=>{window.reviewPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('review transient','QuotaExceededError')};});
await page.getByLabel('你想做什么？').fill('评审项目保存失败');await page.getByRole('button',{name:'开始生成'}).click();
await expect(page.locator('.unsaved')).toContainText('项目保存失败');await expect(f.locator('#saveStatus')).toHaveText('加载失败');
await page.evaluate(()=>{IDBObjectStore.prototype.put=window.reviewPut;});
result.projectFailure={platform:await page.locator('main.workspace').innerText(),buttons:await page.locator('button').allTextContents(),iframe:await f.locator('main').innerText()};
await page.screenshot({path:root+'/project-failure.png',fullPage:true});
writeFileSync(root+'/independent-behavior.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await context.close();
