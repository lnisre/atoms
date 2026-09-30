import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(process.cwd() + '/package.json');
const { chromium, expect } = require('@playwright/test');
const root = 'docs/verification/assets/issue-6/';
const baseline = JSON.parse(readFileSync(root + 'before.json'));
const calls = JSON.parse(readFileSync(root + 'calls.json'));
const outputs = [1,2,3,4].map(n=>readFileSync(root + `candidate-${n}.html`, 'utf8'));
const sha = s=>createHash('sha256').update(s).digest('hex');
for (let i=0;i<4;i++) assert.equal(sha(outputs[i]),calls[i].result.htmlSha256);
assert.equal(sha(baseline.projects[0].result.html),calls[0].request.baseHtmlSha256);
assert.equal(calls[1].request.baseHtmlSha256,sha(outputs[0]));
assert.equal(calls[2].request.baseHtmlSha256,sha(outputs[1]));
assert.equal(calls[3].request.baseHtmlSha256,sha(outputs[2]));
const id = randomUUID(); baseline.projects[0].id=id;baseline.applicationData[0].projectId=id;
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext();
const page = await context.newPage();page.setDefaultTimeout(15000);
let requests=[];
const checks={mode:'unmodified real model artifact replay; controlled API responses; no new model call',hashChain:true};
async function db(){return await page.evaluate(async()=>{
  const d=await new Promise((resolve,reject)=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  const tx=d.transaction(['projects','applicationData']);const result={};
  for(const name of ['projects','applicationData']) {const req=tx.objectStore(name).getAll(); req.onsuccess=()=>result[name]=req.result;}
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject});d.close();return result;
});}
try {
 await page.goto(process.env.TEST_BASE_URL||'https://v0-test0-nine.vercel.app');
 await expect(page.getByText('还没有已保存的项目。生成一个应用后，会自动出现在这里。')).toBeVisible();
 await page.evaluate(async baseline=>{
  const d=await new Promise(resolve=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result)});
  const tx=d.transaction(['projects','applicationData'],'readwrite');for(const name of ['projects','applicationData']) for(const item of baseline[name])tx.objectStore(name).put(item);
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=reject});d.close();
 },baseline);
 await page.goto(`${new URL(page.url()).origin}/?project=${id}`);
 const savedUrl=page.url();const f=page.frameLocator('iframe');
 await expect(f.getByText('真实新产物第一条',{exact:true})).toBeVisible();
 const original=await db();
 await page.route('**/api/generate',async route=>{const i=requests.length;requests.push(route.request().postDataJSON());await route.fulfill({json:{...calls[i].result,html:outputs[i],model:'real-artifact-replay'}})});
 async function modify(text){await page.getByLabel('追加修改需求').fill(text);await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByLabel('本轮对话').locator('li')).toHaveCount(requests.length);await expect(f.getByLabel('新任务内容')).toBeEnabled();}
 await modify('增加任务优先级与筛选');
 assert.equal(requests[0].baseHtml,original.projects[0].result.html);
 await expect(f.locator('li').filter({hasText:'真实新产物第一条'})).toHaveAttribute('data-priority','normal');
 await expect(f.getByRole('button',{name:'标记为未完成：真实新产物第一条',exact:true})).toBeVisible();
 await f.getByRole('group',{name:'选择新任务优先级'}).getByRole('button',{name:'高',exact:true}).press('Enter');
 await f.getByLabel('新任务内容').fill('独立评审试用新增');await f.getByRole('button',{name:'添加任务',exact:true}).press('Enter');
 await expect(f.getByText('独立评审试用新增',{exact:true})).toBeVisible();
 await modify('把筛选放到顶部');
 assert.equal(requests[1].baseHtml,outputs[0]);assert.deepEqual(requests[1].context,['增加任务优先级与筛选']);
 await expect(f.getByText('独立评审试用新增',{exact:true})).toBeVisible();
 const filter=f.getByRole('group',{name:'按优先级筛选'});assert((await filter.boundingBox()).y < (await f.getByLabel('新任务内容').boundingBox()).y);
 await filter.getByRole('button',{name:'高优先',exact:true}).press('Enter');await expect(f.getByText('真实新产物第一条',{exact:true})).toHaveCount(0);await expect(f.getByText('独立评审试用新增',{exact:true})).toBeVisible();
 await filter.getByRole('button',{name:'全部',exact:true}).press('Enter');
 await f.getByRole('button',{name:'标记为未完成：真实新产物第一条',exact:true}).press('Enter');
 await expect(f.getByRole('button',{name:'标记为已完成：真实新产物第一条',exact:true})).toBeVisible();
 await f.getByRole('button',{name:'删除任务：真实新产物第一条',exact:true}).press('Enter');await expect(f.getByText('真实新产物第一条',{exact:true})).toHaveCount(0);
 assert.deepEqual(await db(),original);checks.trialIsolation=true;checks.defaultsAndFilterAndLayout=true;checks.multiround=true;
 await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(1);
 await expect(f.getByText('真实新产物第一条',{exact:true})).toBeVisible();await expect(f.getByText('独立评审试用新增',{exact:true})).toHaveCount(0);
 const adopted=await db();assert.equal(adopted.projects[0].result.html,outputs[1]);assert.deepEqual(adopted.applicationData,original.applicationData);assert.deepEqual(adopted.projects[0].modificationRecords[0].requests,['增加任务优先级与筛选','把筛选放到顶部']);checks.codeOnlyAdoption=true;
 await f.getByLabel('新任务内容').fill('独立评审正式新增');await f.getByRole('button',{name:'添加任务',exact:true}).press('Enter');
 await f.getByRole('button',{name:'标记为已完成：独立评审正式新增',exact:true}).press('Enter');
 await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();const official=await db();
 await page.reload();await expect(f.getByRole('button',{name:'标记为未完成：独立评审正式新增',exact:true})).toBeVisible();assert.deepEqual(await db(),official);
 await page.screenshot({path:'/tmp/atoms-m2-review/replay-adopted.png',fullPage:true});
 await page.close();const reopened=await context.newPage();await reopened.goto(savedUrl);await expect(reopened.getByLabel('已采用修改记录').locator('li')).toHaveCount(1);await expect(reopened.frameLocator('iframe').getByRole('button',{name:'标记为未完成：独立评审正式新增',exact:true})).toBeVisible();assert.equal(requests.length,2);checks.officialSaveAndReopen=true;checks.recoveryModelRequests=0;
 console.log(JSON.stringify(checks));
} catch(e){checks.error=e.stack;console.error(e);if(!page.isClosed())await page.screenshot({path:'/tmp/atoms-m2-review/replay-failed.png',fullPage:true});process.exitCode=1;}
finally {writeFileSync('/tmp/atoms-m2-review/replay-result.json',JSON.stringify(checks,null,2));await browser.close();}
