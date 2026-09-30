import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='/Users/gaowenlong/Desktop/atoms/docs/verification/assets/issue-10';
const c=await chromium.launchPersistentContext('/private/tmp/atoms-m1-save-fix-live',{channel:'chrome',headless:true,viewport:{width:1280,height:720}});
let calls=0;c.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++});
try {
const p=c.pages()[0]??await c.newPage();await p.goto('https://v0-test0-nine.vercel.app');
await expect(p.getByRole('region',{name:'已有项目'}).getByRole('button').first()).toBeVisible();
const data=await p.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['projects','applicationData'],'readonly'),out={};for(const s of ['projects','applicationData'])tx.objectStore(s).getAll().onsuccess=e=>out[s]=e.target.result;tx.oncomplete=()=>{db.close();resolve(out)}}}));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const summary={projects:data.projects.map(x=>({id:x.id,title:x.title,hash:hash(x)})),dataHash:hash(data.applicationData),calls};
const old=data.projects.find(x=>x.id==='e5052705-847c-4858-be72-2b7d57d172c6')??data.projects[0];
await p.goto('https://v0-test0-nine.vercel.app/?project='+old.id);
await expect(p.getByText('应用数据已保存',{exact:true})).toBeVisible();
summary.application=await p.frameLocator('iframe').locator('body').ariaSnapshot();
summary.url=p.url();summary.calls=calls;
const phase=process.argv[2]??'before';
if(phase==='after') {const before=JSON.parse(readFileSync(dir+'/old-project-before.json','utf8'));expect(summary.projects).toEqual(before.projects);expect(summary.dataHash).toBe(before.dataHash);expect(summary.application).toBe(before.application);expect(calls).toBe(0)}
await p.screenshot({path:dir+'/old-project-'+phase+'.png'});writeFileSync(dir+'/old-project-'+phase+'.json',JSON.stringify(summary,null,2));console.log({phase,projects:summary.projects.length,calls,restored:true});
}finally{await c.close()}
