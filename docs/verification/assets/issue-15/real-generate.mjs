import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const dir='/tmp/atoms-issue15-evidence';mkdirSync(dir,{recursive:true});
const c=await chromium.launchPersistentContext('/tmp/atoms-issue15-real-browser',{channel:'chrome',headless:true,viewport:{width:1440,height:900}});
const p=c.pages()[0]??await c.newPage();p.setDefaultTimeout(15000);let calls=0,result;const errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++});
p.on('response',async r=>{if(r.url().endsWith('/api/generate')){result=await r.json();writeFileSync(dir+'/real-initial.html',result.html??'');const {html,...metadata}=result;writeFileSync(dir+'/real-initial.json',JSON.stringify({status:r.status(),htmlLength:html?.length,...metadata},null,2));}});
try {
 const response=await p.goto('https://v0-test0-nine.vercel.app');
 await expect(p.getByRole('heading',{name:'你好，你想创造什么？'})).toBeVisible();
 await p.screenshot({path:dir+'/live-home-1440.png'});
 await p.getByRole('button',{name:'待办清单'}).click();
 await expect(p.getByLabel('你想做什么？')).toHaveValue(/添加、完成、删除/);expect(calls).toBe(0);
 const requirement='做一个名为“入口验收计数器”的极简中文应用。显示当前次数，初始值为 0。提供“增加一次”和“归零”两个按钮。每次操作通过平台提供的 atoms.loadState / atoms.saveState 接口自动保存 {count:number}，刷新后恢复。不使用 localStorage，不依赖外部资源或后端。页面用白底蓝色按钮，清楚显示数字。';
 await p.getByLabel('你想做什么？').fill(requirement);
 await p.getByRole('button',{name:'开始生成'}).click();
 await expect(p.getByText('项目已保存',{exact:true})).toBeVisible({timeout:145000});
 await expect(p.frameLocator('iframe').getByRole('heading',{name:'入口验收计数器'})).toBeVisible();
 const snapshot=await p.frameLocator('iframe').locator('body').ariaSnapshot();
 writeFileSync(dir+'/real-generated-snapshot.txt',snapshot);
 await p.screenshot({path:dir+'/live-generated.png'});
 writeFileSync(dir+'/real-generation-checks.json',JSON.stringify({httpStatus:response.status(),finalUrl:p.url(),calls,errors,requirement,snapshot},null,2));
 console.log(JSON.stringify({httpStatus:response.status(),url:p.url(),calls,snapshot,errors}));
}finally{await c.close();}
