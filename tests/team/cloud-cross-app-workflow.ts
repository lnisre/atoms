import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { CloudProject } from '../../src/lib/cloud-projects/contract';
import { syntheticRequirement, readingChanges, acceptanceScenarios } from './cross-app-scenarios';
import { independentCheck } from './independent-check';

// A new account-cloud contract; the historical requirement and plans stay intact.
export const cloudReadingRequirement=syntheticRequirement('reading')+' 使用平台账号云端保存，另一设备登录同一账号可恢复；不直接读写浏览器存储。';
export type CloudEvidence=(name:string,value:unknown)=>void;
export async function readOwnProject(page:Page, owner:string):Promise<CloudProject>{
 const id=new URL(page.url()).searchParams.get('project');if(!id)throw new Error('No committed project URL');
 const response=await page.evaluate(async({id,owner})=>{const r=await fetch(`/api/projects/${id}`,{headers:{'X-Atoms-Account':owner}});return {status:r.status,body:await r.json()};},{id,owner});
 expect(response.status).toBe(200);return response.body;
}
export async function cloudCrossAppWorkflow(a:BrowserContext,b:BrowserContext,base:string,evidence:CloudEvidence){
 const first=await a.newPage(),second=await b.newPage();
 let requests=0;const count=(r:{url:()=>string})=>{if(new URL(r.url()).pathname==='/api/generate')requests++;};a.on('request',count);b.on('request',count);
 const own=async(page:Page)=>{await page.goto(base);const r=await page.evaluate(async()=>{const r=await fetch('/api/auth/session');return {status:r.status,body:await r.json()};});expect(r.status).toBe(200);return r.body.account.id as string;};
 const owner=await own(first);expect(await own(second)).toBe(owner);
 const app=(page:Page)=>page.frameLocator('iframe[title="生成的应用"]');
 const saved=(page:Page)=>expect(page.getByText('应用数据已保存到云端',{exact:true})).toBeVisible();
 try{
  await first.getByLabel('你想做什么？').fill(cloudReadingRequirement);await first.getByRole('button',{name:'开始生成',exact:true}).click();
  await expect(first.getByText('云端已保存代码',{exact:false})).toBeVisible({timeout:260000});
  const initial=await readOwnProject(first,owner);evidence('initial',{projectId:initial.project.id,version:initial.version,policy:initial.project.previewPolicy,task:initial.project.initialGeneration});
  if(initial.project.draftResult||initial.project.previewPolicy?.dataMode==='trial'||initial.project.previewPolicy?.status==='blocked')throw new Error('Initial outcome is restricted; preserve evidence, do not silently activate it');
  await app(first).locator('#name').fill('验收书 A');await app(first).locator('#add').click();await saved(first);await expect(app(first).locator('#records .title')).toHaveText(['验收书 A']);
  await app(first).locator('#name').fill('验收书 B');await app(first).locator('#add').click();await saved(first);await expect(app(first).locator('#records .title')).toHaveText(['验收书 A','验收书 B']);
  await app(first).locator('#records li').first().locator('.toggle').click();await saved(first);
  await app(first).locator('#records li').last().locator('.remove').click();await saved(first);await expect(app(first).locator('#records .title')).toHaveText(['验收书 A']);
  const formal=await readOwnProject(first,owner);expect(formal.state).toMatchObject({books:[{name:'验收书 A',status:'finished'}]});evidence('formal',formal);
  const afterInitial=requests;await second.goto(first.url());await expect(app(second).locator('#records .title')).toHaveText(['验收书 A']);expect(requests).toBe(afterInitial);
  const qa=await a.newPage();try{await qa.goto(new URL('/qa',base).href);const proof=await independentCheck(qa,initial.project.result.html,acceptanceScenarios('reading'));evidence('initial-independent',proof);expect(proof.result.status).toBe('passed');}finally{await qa.close();}
  for(let round=0;round<readingChanges.length;round++){
   await first.getByLabel('追加修改需求').fill(readingChanges[round]);await first.getByRole('button',{name:'生成候选',exact:true}).click();await expect(first.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled({timeout:260000});
   await expect(app(first).locator('.score')).toBeVisible();
   if(round===0){await app(first).locator('.score').selectOption('4');await expect(app(first).locator('[data-atoms-status]')).toHaveText('已保存');}
   else await expect(app(first).locator('.score')).toHaveValue('4');
   expect((await readOwnProject(first,owner)).state).toEqual(formal.state);
  }
  await app(first).locator('#filter').selectOption('active');await expect(app(first).locator('#records .title')).toHaveCount(0);await app(first).locator('#filter').selectOption('all');await expect(app(first).locator('#records .title')).toHaveText(['验收书 A']);
  await first.getByRole('button',{name:'采用修改',exact:true}).click();await expect(first.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);await saved(first);
  await expect(first.getByText('代码已保存，正在追加云端提交步骤日志…',{exact:true})).toHaveCount(0);
  await expect(first.getByRole('button',{name:'重试记录保存'})).toHaveCount(0);
  const adopted=await readOwnProject(first,owner);expect(adopted.state).toEqual(formal.state);expect(adopted.project.modificationRecords).toHaveLength(1);expect(adopted.project.modificationRecords![0].generations).toHaveLength(2);evidence('adopted',adopted);
  const verification=await a.newPage();try{await verification.goto(new URL('/qa',base).href);const proof=await independentCheck(verification,adopted.project.result.html,acceptanceScenarios('reading',true));evidence('adopted-independent',proof);expect(proof.result.status).toBe('passed');}finally{await verification.close();}
  const beforeRecovery=requests;await first.reload();await second.reload();for(const page of [first,second]){await expect(app(page).locator('#records .title')).toHaveText(['验收书 A']);await expect(app(page).locator('.score')).toHaveValue('0');}
  expect(requests).toBe(beforeRecovery);evidence('recovery',{projectId:adopted.project.id,generationHTTPRequests:requests,recoveryRequests:0,independentContexts:true});
 }finally{a.off('request',count);b.off('request',count);await first.close();await second.close();}
}
