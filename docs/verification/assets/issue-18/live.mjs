import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='/tmp/atoms-issue18',profile='/tmp/atoms-issue18-real-browser',origin='https://v0-test0-nine.vercel.app';
const baseline=JSON.parse(readFileSync(dir+'/legacy-before.json'));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const results=[],requests=[],waiting=[],errors=[];let c,p,calls=0;
async function launch(){c=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:1440,height:900}});p=c.pages()[0];p.setDefaultTimeout(30000);c.on('request',r=>{if(r.url().endsWith('/api/generate')){calls++;requests.push({...r.postDataJSON(),taskId:r.headers()['x-atoms-task-id']})}});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>{const original=window.fetch;window.capturedGenerationBodies=[];window.fetch=async(...args)=>{const response=await original(...args);if(args[0]==='/api/generate')window.capturedGenerationBodies.push(response.clone().text());return response}})}
async function snapshot(){return p.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['projects','applicationData']);const projects=tx.objectStore('projects').getAll(),data=tx.objectStore('applicationData').getAll();tx.oncomplete=()=>{db.close();resolve({projects:projects.result,data:data.result})}}}))}
async function capture(name){await p.screenshot({path:dir+'/'+name+'.png'});const boxes=await p.evaluate(()=>Object.fromEntries(['.topbar','.workspace','.project-panel','.conversation-scroll','.modification-panel','.preview-panel','.preview-navigation','.preview-toolbar','.candidate-actions','iframe'].map(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return [s,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null]})));writeFileSync(dir+'/'+name+'-layout.json',JSON.stringify(boxes,null,2));}
async function generation(n,text,initial=false){
 if(initial){await p.getByLabel('你想做什么？').fill(text);await p.getByRole('button',{name:'开始生成'}).click()}
 else{await p.getByLabel('追加修改需求').fill(text);await p.getByRole('button',{name:'生成候选',exact:true}).click()}
 const record=p.getByRole('region',{name:initial?'首次生成记录':'本轮修改记录'}).last();
 await expect(record.getByText('调用模型',{exact:true})).toBeVisible();
 waiting.push({round:n,calls,at:new Date().toISOString(),text:await record.innerText()});
 await capture('generating-'+n);
 const textBody=await p.evaluate(async()=>await window.capturedGenerationBodies.at(-1));
 const events=textBody.trim().split('\n').map(x=>JSON.parse(x)),terminal=events.at(-1);
 writeFileSync(`${dir}/round-${n}-events.json`,JSON.stringify(events.filter(x=>x.type!=='result'),null,2));
 expect(terminal.type).toBe('result');expect(terminal.assistantReply?.trim().length).toBeGreaterThan(0);
 await expect(record.locator('.assistant-reply')).toHaveText(terminal.assistantReply);
 if(initial){await expect(p.getByText('项目已保存',{exact:true})).toBeVisible();await expect(p.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0)}
 else await expect(p.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
 await expect(p.frameLocator('iframe').locator('#countValue')).toBeVisible();
 writeFileSync(`${dir}/round-${n}.html`,terminal.result.html);writeFileSync(`${dir}/round-${n}-reply.txt`,terminal.assistantReply);
 results.push({round:n,taskId:terminal.taskId,model:terminal.result.model,durationMs:terminal.result.durationMs,replyLength:terminal.assistantReply.length,htmlLength:terminal.result.html.length,htmlHash:hash(terminal.result.html),requirement:text});
 console.log(JSON.stringify(results.at(-1)));return terminal.result.html;
}
try{
 await launch();await p.goto(baseline.url);await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('6');expect(await snapshot()).toEqual(baseline.saved);expect(calls).toBe(0);
 writeFileSync(dir+'/upgrade.json',JSON.stringify({unchanged:true,calls,hash:hash(baseline.saved),projects:baseline.saved.projects.length},null,2));
 await p.getByRole('button',{name:'Atoms 首页'}).click();await capture('home-1440');
 await p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的项目',exact:true}).click();await capture('projects-1440');
 await p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true}).click();
 const first=await generation(0,'创建名为「工作台验收计数器」的极简中文前端应用，白底蓝色按钮。显示当前次数，显示元素 id=countValue，按钮文字“增加一次”，每次加1。使用 atoms.loadState()/atoms.saveState() 保存 {count:number}。旧数据不存在时默认为0，读取完成后启用按钮，不在初始化时保存默认值。每次点击等待保存并提示。不要外部依赖、登录或后端。助手说明已实现的交互和实际限制。',true);
 const url=p.url(),id=new URL(url).searchParams.get('project');const f=p.frameLocator('iframe');
 await expect(f.locator('#countValue')).toHaveText('0');
 for(let i=0;i<2;i++){await f.getByRole('button',{name:'增加一次',exact:true}).press('Enter');await expect(f.locator('#countValue')).toHaveText(String(i+1));await expect(p.getByText('应用数据已保存',{exact:true})).toBeVisible()}
 await expect(p.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0);
 await capture('adopted-1440');const original=await snapshot();
 await p.reload();await expect(f.locator('#countValue')).toHaveText('2');expect(await snapshot()).toEqual(original);expect(calls).toBe(1);
 const second=await generation(1,'保留所有功能、id=countValue 和 {count:number} 数据格式，增加“减少一次”按钮，每次减1，最低0。旧业务数据原样恢复，不自动写默认值。助手说明本轮变化。');
 expect(requests[1].baseHtml).toBe(first);
 await f.getByRole('button',{name:'减少一次',exact:true}).press('Enter');await expect(f.locator('#countValue')).toHaveText('1');
 const third=await generation(2,'保留当前增加一次、减少一次、id=countValue 与数据格式，增加“增加五次”按钮，一次加5；把标题改为“工作台多轮验收”。旧业务数据原样恢复，不自动写默认值。助手说明本轮变化。');
 expect(requests[2].baseHtml).toBe(second);expect(requests[2].context).toEqual([results[1].requirement]);
 await expect(f.locator('#countValue')).toHaveText('1');await f.getByRole('button',{name:'增加五次',exact:true}).press('Enter');await expect(f.locator('#countValue')).toHaveText('6');
 expect(await snapshot()).toEqual(original);
 await p.getByLabel('追加修改需求').fill('保留这条未提交输入');const candidate=await p.locator('iframe').elementHandle();
 await capture('candidate-1440');
 await p.getByRole('region',{name:'本轮修改记录'}).last().getByText('载入隔离预览',{exact:true}).click();
 await capture('details-1440');
 await p.setViewportSize({width:1280,height:720});await capture('candidate-details-1280');
 await expect(p.getByLabel('追加修改需求')).toHaveValue('保留这条未提交输入');await expect(f.locator('#countValue')).toHaveText('6');expect(await candidate.evaluate(el=>el.isConnected)).toBe(true);
 for(const target of [p.getByLabel('追加修改需求'),p.getByRole('button',{name:'采用修改',exact:true}),p.getByRole('button',{name:'放弃本轮修改'}),p.locator('iframe')]){const box=await target.boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(720)}
 expect(calls).toBe(3);
 await p.getByRole('button',{name:'采用修改',exact:true}).click();await expect(p.getByText('运行预览 · 已采用应用')).toBeVisible();await expect(f.locator('#countValue')).toHaveText('2');
 let saved=await snapshot();const adopted=saved.projects.find(x=>x.id===id);expect(saved.data).toEqual(original.data);expect(adopted.result.html).toBe(third);expect(adopted.initialGeneration).toEqual(original.projects.find(x=>x.id===id).initialGeneration);expect(adopted.modificationRecords[0].generations.map(x=>x.taskId)).toEqual(results.slice(1).map(x=>x.taskId));
 writeFileSync(dir+'/adopted-records.json',JSON.stringify(adopted.modificationRecords,null,2));
 await f.getByRole('button',{name:'增加五次',exact:true}).press('Enter');await expect(f.locator('#countValue')).toHaveText('7');await expect(p.getByText('应用数据已保存',{exact:true})).toBeVisible();saved=await snapshot();
 await p.reload();await expect(f.locator('#countValue')).toHaveText('7');expect(await snapshot()).toEqual(saved);expect(calls).toBe(3);await capture('restored-1280');
 await c.close();await launch();await p.goto(origin);await p.getByRole('region',{name:'已有项目'}).getByRole('button',{name:/工作台验收计数器/}).click();await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('7');expect(await snapshot()).toEqual(saved);expect(calls).toBe(3);
 await generation(3,'保留当前全部按钮、数据和 id=countValue，增加“翻倍”按钮，将次数乘以2。旧数据保持不变，不在初始化时写默认值。助手说明新增功能。');expect(requests[3].baseHtml).toBe(third);expect(requests[3].context).toEqual([]);
 await p.frameLocator('iframe').getByRole('button',{name:'翻倍',exact:true}).press('Enter');await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('14');expect(await snapshot()).toEqual(saved);
 await p.reload();await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('7');await expect(p.frameLocator('iframe').getByRole('button',{name:'翻倍',exact:true})).toHaveCount(0);expect(await snapshot()).toEqual(saved);expect(calls).toBe(4);await capture('reopened-1440');
 await p.getByRole('button',{name:'Atoms 首页'}).click();await p.setViewportSize({width:1280,height:720});await capture('home-1280');await p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的项目',exact:true}).click();await capture('projects-1280');
 writeFileSync(dir+'/live-summary.json',JSON.stringify({calls,results,waiting,errors,upgradeUnchanged:true,trialCount:6,adoptionCount:2,formalCount:7,unadoptedTrial:14,restoredCount:7,recoveryCalls:0,finalSavedHash:hash(saved),projectId:id},null,2));console.log(JSON.stringify({calls,recoveryCalls:0,errors,formalCount:7}));
}catch(e){writeFileSync(dir+'/live-failure.txt',String(e.stack));writeFileSync(dir+'/live-partial.json',JSON.stringify({calls,results,waiting,errors},null,2));if(p){writeFileSync(dir+'/live-failure-page.txt',await p.locator('body').innerText().catch(()=>''));await p.screenshot({path:dir+'/live-failure.png'}).catch(()=>{})}console.error(e);process.exitCode=1}finally{await c?.close()}
