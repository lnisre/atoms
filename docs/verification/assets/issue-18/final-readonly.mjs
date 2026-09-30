import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
const dir='/tmp/atoms-issue18',summary=JSON.parse(readFileSync(dir+'/live-summary.json')),old=JSON.parse(readFileSync(dir+'/legacy-before.json'));
const c=await chromium.launchPersistentContext('/tmp/atoms-issue18-real-browser',{channel:'chrome',headless:true,viewport:{width:1280,height:720}});
try{
 const p=c.pages()[0];let calls=0;p.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++});
 await p.goto('https://v0-test0-nine.vercel.app/?project='+summary.projectId);await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('7');
 const rec=p.getByRole('region',{name:'已保存修改记录'}).last();await rec.getByText('采用代码与消息',{exact:true}).click();await rec.getByText('采用代码与消息',{exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:dir+'/restored-details-1280.png'});
 await p.setViewportSize({width:1440,height:900});await p.getByRole('button',{name:'Atoms 首页'}).click();await p.screenshot({path:dir+'/home-1440.png'});await p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的项目',exact:true}).click();await p.screenshot({path:dir+'/projects-1440.png'});
 await p.goto(old.url);await expect(p.frameLocator('iframe').locator('#countValue')).toHaveText('6');
 const saved=await p.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['projects','applicationData']);const a=tx.objectStore('projects').getAll(),b=tx.objectStore('applicationData').getAll();tx.oncomplete=()=>{db.close();resolve({projects:a.result,data:b.result})}}}));
 for(const project of old.saved.projects)expect(saved.projects.find(x=>x.id===project.id)).toEqual(project);
 for(const data of old.saved.data)expect(saved.data.find(x=>x.projectId===data.projectId)).toEqual(data);
 expect(calls).toBe(0);writeFileSync(dir+'/final-readonly.json',JSON.stringify({calls,oldProjectsUnchanged:old.saved.projects.length,oldDataUnchanged:old.saved.data.length,newFormalCount:7,oldFormalCount:6},null,2));
}finally{await c.close()}
