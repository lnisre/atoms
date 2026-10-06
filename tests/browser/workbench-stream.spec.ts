import { fulfillGeneration } from "./team-fixture";
import assert from 'node:assert/strict';
import { expect, test, type Page } from '@playwright/test';

type GenerationRequest = { requirement: string; modification: string | null };
async function generationRequests(page: Page, routed: GenerationRequest[]) {
  return [...routed, ...await page.evaluate(() => (window as unknown as { workbenchRequests: GenerationRequest[] }).workbenchRequests ?? [])];
}
async function expectGenerationRequests(page: Page, routed: GenerationRequest[], expected: GenerationRequest[]) {
  expect(await generationRequests(page, routed)).toEqual(expected);
}

const html = '<!DOCTYPE html><html><head></head><body><button>增加</button><output>0</output><script>let n=0;atoms.loadState().then(s=>{n=s??0;document.querySelector("output").textContent=n});document.querySelector("button").onclick=()=>{document.querySelector("output").textContent=++n;atoms.saveState(n)}</script></body></html>';
for (const viewport of [{width:1440,height:900},{width:1280,height:720}]) {
  test(`顺序消息、上翻保全、禁用工具与展示调整 ${viewport.width}`, async ({page}, testInfo) => {
    await page.setViewportSize(viewport);
    const routed: GenerationRequest[] = [];
    const initial = { requirement: '顺序测试初始需求', modification: null };
    const expected = [initial, { ...initial, modification: '第二条用户需求' }];
    await page.route('**/api/generate', route => {
      const input = route.request().postDataJSON();
      routed.push({ requirement: input.requirement, modification: input.modification ?? null });
      const taskId=route.request().headers()['x-atoms-task-id'];
      return fulfillGeneration(route, {contentType:'application/x-ndjson',body:JSON.stringify({type:'result',taskId,result:{html,model:'fixture',durationMs:1,generatedAt:String(routed.length)},assistantReply:'完整说明\n'+('长回复用于检验滚动。\n'.repeat(90))})+'\n'});
    });
    await page.goto('/');await page.getByLabel('你想做什么？').fill('顺序测试初始需求');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();
    await expectGenerationRequests(page, routed, [initial]);
    const iframe=await page.locator('iframe').elementHandle();
    const scroll=page.getByRole('region',{name:'项目对话与详情'});
    await expect.poll(()=>scroll.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(25);
    await page.evaluate(({html})=>{
      const original=window.fetch;
      const requests: GenerationRequest[] = [];
      Object.assign(window, { workbenchRequests: requests });
      window.fetch=async(...args)=>{
        if(args[0]!=='/api/generate')return original(...args);
        const taskId=new Headers(args[1]?.headers).get('X-Atoms-Task-Id'),encoder=new TextEncoder();let sequence=0;
        const input=JSON.parse(String(args[1]?.body)),projectId=input.projectId;
        requests.push({ requirement: input.requirement, modification: input.modification ?? null });
        Object.assign(window, { workbenchLastInput: input });
        const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
        const codeHash=await hash(html),baseCodeHash=await hash(input.baseHtml);
        const review={kind:'code-review',schemaVersion:1,resolutions:[],taskId,codeHash,approved:true,summary:'synthetic',issues:[]};
        const assign=(to:string)=>({role:'Mike',content:JSON.stringify({command:'assign',to})});
        const deliveries=[assign('Requirements'),{role:'Requirements',content:JSON.stringify({requirements:[{id:'fixture'}]})},assign('Engineer'),{role:'Engineer',content:JSON.stringify({codeHash,iteration:1})},assign('Reviewer'),{role:'Reviewer',content:JSON.stringify(review)},{role:'Mike',content:JSON.stringify({command:'finish'})}];
        const team={protocol:'atoms-team/3',taskId,projectId,codeHash,baseCodeHash,review,outcome:"passed",deliveries,calls:deliveries.map((d,i)=>({call:i+1,actor:d.role,status:'completed',requestedModel:'fixture'}))};
        return new Response(new ReadableStream({start(controller){
          const emit=(stepId:string,status:string)=>controller.enqueue(encoder.encode(JSON.stringify({type:'step',event:{taskId,source:'server',sequence:++sequence,stepId,label:'受控实际步骤 '+stepId,status,at:new Date().toISOString(),detail:'上游夹具事件'}})+'\n'));
          controller.enqueue(encoder.encode(JSON.stringify({type:'session',protocol:'atoms-team/3',taskId,projectId,token:'fixture'})+'\n'));
          emit('model','started');
          Object.assign(window,{appendWorkbenchEvents:()=>{for(let i=0;i<20;i++)emit('extra-'+i,'completed')},finishWorkbench:()=>{emit('model','completed');controller.enqueue(encoder.encode(JSON.stringify({type:'result',protocol:'atoms-team/3',taskId,team,result:{html,model:'fixture',durationMs:1,generatedAt:'second'},assistantReply:'第二轮模型说明'})+'\n'));controller.close()}});
        }}),{headers:{'Content-Type':'application/x-ndjson'}});
      };
    },{html});
    await page.getByLabel('追加修改需求').fill('第二条用户需求');await page.getByRole('button',{name:'生成候选',exact:true}).click();
    await expect(page.getByText('受控实际步骤 model',{exact:true})).toBeVisible();
    await expectGenerationRequests(page, routed, expected);
    // Browser scroll events may also follow content growth; they are not user intent.
    await scroll.evaluate(el=>el.dispatchEvent(new Event('scroll')));
    await expect.poll(()=>scroll.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(25);
    await scroll.evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event('scroll'))});
    const before=await scroll.evaluate(el=>el.scrollTop);
    await page.evaluate(()=>(window as unknown as {appendWorkbenchEvents:()=>void}).appendWorkbenchEvents());
    await expect(page.locator('.current-dialogue .execution-card li')).toHaveCount(22);
    expect(await scroll.evaluate(el=>el.scrollTop)).toBe(before);
    expect(await iframe!.evaluate(el=>el.isConnected)).toBe(true);
    await page.evaluate(()=>(window as unknown as {finishWorkbench:()=>void}).finishWorkbench());
    await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
    expect(await scroll.evaluate(el=>el.scrollTop)).toBe(before);
    await expect(page.locator('.user-message p')).toHaveText(['顺序测试初始需求','第二条用户需求']);
    await page.getByRole('button',{name:'回到最新消息 ↓'}).click();
    await expect.poll(()=>scroll.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(25);
    const candidate=await page.locator('iframe').elementHandle();
    await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await page.getByLabel('追加修改需求').fill('未提交的草稿');
    await page.locator('.current-dialogue').getByText('载入隔离预览',{exact:true}).click();
    const disabled=page.locator('.workbench button.unavailable');expect(await disabled.count()).toBeGreaterThan(12);
    for(const button of await disabled.all()) {
      await expect(button).toBeDisabled();await expect(button).toHaveAttribute('title',/当前未提供/);
      await button.evaluate((el:HTMLButtonElement)=>{el.click();el.focus()});
      expect(await button.evaluate(el=>el===document.activeElement)).toBe(false);
    }
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1280,height:720});
    await expect(page.getByLabel('追加修改需求')).toHaveValue('未提交的草稿');
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    expect(await candidate!.evaluate(el=>el.isConnected)).toBe(true);await expectGenerationRequests(page, routed, expected);
    for(const target of [page.locator('iframe'),page.getByLabel('追加修改需求'),page.getByRole('button',{name:'采用修改',exact:true}),page.getByRole('button',{name:'放弃本轮修改'})]) {
      const box=await target.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(720);
    }
    await page.screenshot({path:testInfo.outputPath('stream-details.png')});
    await testInfo.attach('generation-requests', { body: JSON.stringify(await generationRequests(page, routed)), contentType: 'application/json' });
    if (viewport.width === 1440) {
      // Negative control: traverse the SAME installed transport. A route-only
      // counter still reads one, but the unchanged-request assertion must reject.
      await page.evaluate(async () => {
        const state = window as unknown as { workbenchLastInput: Record<string, unknown>; finishWorkbench: () => void };
        const response = await window.fetch('/api/generate', { method: 'POST', headers: { 'X-Atoms-Task-Id': 'negative-extra' },
          body: JSON.stringify({ ...state.workbenchLastInput, modification: 'NEGATIVE_EXTRA_REQUEST' }) });
        state.finishWorkbench();
        await response.text();
      });
      expect(routed).toHaveLength(1);
      expect(await generationRequests(page, routed)).toEqual([...expected, { ...initial, modification: 'NEGATIVE_EXTRA_REQUEST' }]);
      await assert.rejects(() => expectGenerationRequests(page, routed, expected), /toEqual/);
      await testInfo.attach('extra-request-rejected', { body: JSON.stringify(await generationRequests(page, routed)), contentType: 'application/json' });
    }
  });
}
