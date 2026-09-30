import {chromium,expect} from '/Users/gaowenlong/Desktop/atoms/node_modules/@playwright/test/index.mjs';
const c=await chromium.launchPersistentContext('/tmp/atoms-issue15-real-browser',{channel:'chrome',headless:true,viewport:{width:1440,height:900}});let calls=0;c.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++});
try{const p=c.pages()[0]??await c.newPage();await p.goto('https://v0-test0-nine.vercel.app');
for(const [width,height] of [[1440,900],[1280,720]]){
 await p.setViewportSize({width,height});await p.getByRole('button',{name:'我的项目',exact:true}).click();
 await expect(p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'我的项目'})).toHaveAttribute('aria-current','page');
 await expect(p.getByRole('heading',{name:'我的项目',exact:true,level:1})).toBeVisible();
 await expect(p.getByRole('region',{name:'已有项目'}).getByRole('button',{name:/入口验收计数器/})).toBeVisible();
 await p.screenshot({path:`/tmp/atoms-issue15-evidence/live-projects-${width}.png`});
 await p.getByRole('button',{name:'首页',exact:true}).click();await expect(p.getByRole('heading',{name:'你好，你想创造什么？'})).toBeVisible();
 await p.screenshot({path:`/tmp/atoms-issue15-evidence/live-home-${width}.png`});
}expect(calls).toBe(0);console.log({screenshots:4,calls});}finally{await c.close()}
