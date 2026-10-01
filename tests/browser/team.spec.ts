import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

test("M5 rejects a legacy HTML-only first-generation response",async({page})=>{
  await page.route('**/api/generate',r=>r.fulfill({json:{html:'<!DOCTYPE html><html><head></head><body>old</body></html>',model:'legacy',durationMs:1,generatedAt:new Date().toISOString()}}));
  await page.goto('/');await page.getByLabel('你想做什么？').fill('旧协议拒绝');await page.getByRole('button',{name:'开始生成'}).click();
  await expect(page.getByRole('heading',{name:'生成未完成'})).toBeVisible();
  await expect(page.getByRole("alert").filter({hasText:"旧 HTML 响应未被接受"})).toBeVisible();await expect(page.locator('iframe')).toHaveCount(0);
});

test.describe('native Team and code review using scripted test provider',()=>{
  test.skip(process.env.TEAM_FIXTURE !== '1','Requires explicitly configured deterministic transport, never runs against a real provider');
  test.setTimeout(90000);
  test('HTTP team → code review → save → operations → reopen with zero generation requests',async({page,context})=>{
    let calls=0;page.on('request',r=>{if(r.url().endsWith('/api/generate'))calls++});
    await page.goto('/');await page.getByLabel('你想做什么？').fill('受控计数器集成验证');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});
    await expect(page.getByText(/代码审查：通过/)).toBeVisible();
    await expect(page.frameLocator('iframe').getByRole('button',{name:'增加'})).toBeEnabled();
    await page.frameLocator('iframe').getByRole('button',{name:'增加'}).press('Enter');
    await expect(page.getByText('应用数据已保存',{exact:true})).toBeVisible();
    await page.getByLabel('追加修改需求').fill('保留输入');
    await page.getByText('需求负责人 · 规格',{exact:true}).click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await expect(page.getByLabel('追加修改需求')).toHaveValue('保留输入');
    await expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0);
    const evidence=await page.evaluate(async()=>{
      const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('atoms-projects',1);r.onsuccess=()=>resolve(r.result)});
      const project=await new Promise<unknown>(resolve=>{const r=db.transaction('projects').objectStore('projects').getAll();r.onsuccess=()=>resolve(r.result[0])});db.close();return project;
    });
    if(process.env.TEAM_EVIDENCE_DIR){mkdirSync(process.env.TEAM_EVIDENCE_DIR,{recursive:true});writeFileSync(`${process.env.TEAM_EVIDENCE_DIR}/scripted-native-team.json`,JSON.stringify({kind:'deterministic provider, actual MetaGPT/HTTP/browser/storage',evidence},null,2))}
    const url=page.url();await page.reload();await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await page.close();const reopened=await context.newPage();let extra=0;reopened.on('request',r=>{if(r.url().endsWith('/api/generate'))extra++});await reopened.goto(url);
    await expect(reopened.frameLocator('iframe').locator('output')).toHaveText('1');await expect(reopened.getByText(/代码审查：通过/)).toBeVisible();expect(extra).toBe(0);expect(calls).toBe(1);
  });
  test('leaving while Reviewer runs closes the connection; no hidden delivery',async({page,context})=>{
    let socketClosed=false, reviewStarted=false, callsAtClose=0, callsAfterClose=0;
    await page.routeWebSocket('**/api/team/socket', ws => {
      const upstream=ws.connectToServer();
      upstream.onMessage(raw=>{
        const message=JSON.parse(String(raw));
        if(message.type==='call' && message.call.status==='started') {if(socketClosed)callsAfterClose++;else callsAtClose++;}
        if(message.type==='call' && message.call.actor==='Reviewer' && message.call.status==='started')reviewStarted=true;
        ws.send(raw);
      });
      ws.onClose(()=>{socketClosed=true;upstream.close();});
    });
    await page.goto('/');await page.getByLabel('你想做什么？').fill('离开中止验证');await page.getByRole('button',{name:'开始生成'}).click();
    await expect.poll(()=>reviewStarted,{timeout:45000}).toBe(true);
    await page.goto("about:blank");await expect.poll(()=>socketClosed).toBe(true);
    const reopened=await context.newPage();await reopened.goto('/');
    await expect(reopened.getByRole('heading',{name:'还没有已保存的项目'})).toBeVisible();
    expect(callsAtClose).toBeGreaterThan(0);expect(callsAfterClose).toBe(0);
  });
  test('wrong-code result is rejected and no project is delivered',async({page})=>{
    let tampered=false;
    await page.routeWebSocket('**/api/team/socket', ws => {
      const upstream = ws.connectToServer();
      upstream.onMessage(raw => {
        const body = JSON.parse(String(raw));
        if(body.type === 'result') {tampered=true;body.team.review.codeHash='0'.repeat(64);}
        ws.send(JSON.stringify(body));
      });
    });
    await page.goto('/');await page.getByLabel('你想做什么？').fill('受控错代码结果');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByRole('heading',{name:'生成未完成'})).toBeVisible({timeout:65000});
    expect(tampered).toBe(true);
    await expect(page.getByText('项目已保存',{exact:true})).toHaveCount(0);await expect(page.locator('iframe')).toHaveCount(0);
  });
  test('remaining nonfatal findings after two native repairs still preview and save',async({page})=>{
    const events: Record<string,unknown>[]=[];
    page.on('websocket',ws=>ws.on('framereceived',e=>{const m=JSON.parse(String(e.payload));if(m.type==='delivery')events.push(m.delivery)}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('审查拒绝受控验证');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});
    await expect(page.getByText(/代码审查：有待修复问题/)).toBeVisible();
    await expect(page.locator('iframe')).toBeVisible();
    expect(events.filter(e=>e.role==='Engineer')).toHaveLength(3);
    expect(events.filter(e=>e.role==='Reviewer')).toHaveLength(3);
    await expect(page.getByLabel('追加修改需求')).toBeEnabled();
  });

  test('one real native repair is shown, saved and restored with rejection history',async({page})=>{
    const events: Record<string,unknown>[]=[];
    page.on('websocket',ws=>ws.on('framereceived',e=>{const m=JSON.parse(String(e.payload));if(m.type==='delivery')events.push(m.delivery)}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('一次修复受控验证');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});
    await expect(page.getByText('实现工程师 · 交付 · 第 1 次整体返工',{exact:true})).toBeVisible();
    await expect(page.getByText('Reviewer · 代码审查 · 新代码复审',{exact:true})).toBeVisible();
    const reviews=events.filter(e=>e.role==='Reviewer').map(e=>JSON.parse(String(e.content)));
    expect(reviews.map(r=>r.approved)).toEqual([false,true]);expect(reviews[0].codeHash).not.toBe(reviews[1].codeHash);
    expect(events.filter(e=>e.role==='Engineer')).toHaveLength(2);
    await page.frameLocator('iframe').getByRole('button',{name:'增加'}).click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0);
    await page.reload();await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await expect(page.getByText('Reviewer · 代码审查 · 新代码复审',{exact:true})).toBeVisible();
  });
  test('stop during rereview releases waiting and prevents a late delivery',async({page})=>{
    let reviews=0,closed=false,callsAfterClose=0;
    await page.routeWebSocket('**/api/team/socket',ws=>{
      const upstream=ws.connectToServer();upstream.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='call'&&m.call.status==='started'){if(closed)callsAfterClose++;if(m.call.actor==='Reviewer')reviews++;}ws.send(raw)});
      ws.onClose(()=>{closed=true;upstream.close()});
    });
    await page.goto('/');await page.getByLabel('你想做什么？').fill('一次修复 停止返工');await page.getByRole('button',{name:'开始生成'}).click();
    await expect.poll(()=>reviews,{timeout:65000}).toBe(2);await page.getByRole('button',{name:'停止任务'}).click();
    await expect(page.getByRole('heading',{name:'任务已停止'})).toBeVisible();await expect.poll(()=>closed).toBe(true);
    await expect(page.getByRole('button',{name:'停止任务'})).toHaveCount(0);await expect(page.locator('iframe')).toHaveCount(0);expect(callsAfterClose).toBe(0);
    await page.reload();await expect(page.getByRole('heading',{name:'还没有已保存的项目'})).toBeVisible();
  });
  test('clarification ends its task, retains questions and restarts with a new identity',async({page})=>{
    const taskIds: string[]=[];let calls=0;
    page.on('request',r=>{if(r.url().endsWith('/api/generate'))taskIds.push(r.headers()['x-atoms-task-id'])});
    page.on('websocket',ws=>ws.on('framereceived',e=>{const m=JSON.parse(String(e.payload));if(m.type==='call'&&m.call.status==='started')calls++;}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('关键歧义计数器');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByRole('heading',{name:'需要补充需求'})).toBeVisible({timeout:65000});expect(calls).toBe(2);
    await expect(page.getByRole('alert').filter({hasText:'计数是否允许负数'})).toContainText('计数是否允许负数');await expect(page.getByRole('button',{name:'停止任务'})).toHaveCount(0);
    await page.getByLabel('补充或调整需求').fill('允许负数，重置归零');await page.getByRole('button',{name:'补充后重新发起'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});expect(taskIds).toHaveLength(2);expect(taskIds[0]).not.toBe(taskIds[1]);
    await expect(page.getByRole('region',{name:'此前任务记录'})).toContainText('计数是否允许负数');
  });
  test('format correction is not code repair and repeated invalid output fails',async({page})=>{
    await page.goto('/');await page.getByLabel('你想做什么？').fill('格式纠正 持续无效');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});await expect(page.getByText('执行失败',{exact:true})).toBeVisible();await expect(page.getByText(/审查未完成，代码已保留/)).toBeVisible();await expect(page.locator('iframe')).toBeVisible();
    await expect(page.getByText('实现工程师 · 交付',{exact:true})).toHaveCount(1);await expect(page.getByText('实现工程师 · 交付 · 第 1 次整体返工',{exact:true})).toHaveCount(0);
  });
  test('unsupported requirements explain a feasible adjustment and end',async({page})=>{
    await page.goto('/');await page.getByLabel('你想做什么？').fill('任意后端');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByRole('heading',{name:'暂不支持此需求'})).toBeVisible({timeout:65000});await expect(page.getByRole('alert').filter({hasText:'同浏览器保存'})).toContainText('同浏览器保存');await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('one review format correction succeeds without an Engineer repair',async({page})=>{
    let calls=0;page.on('websocket',ws=>ws.on('framereceived',e=>{const m=JSON.parse(String(e.payload));if(m.type==='call'&&m.call.status==='started')calls++;}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('格式纠正成功');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible({timeout:65000});expect(calls).toBe(8);
    await expect(page.getByText('实现工程师 · 交付',{exact:true})).toHaveCount(1);await expect(page.getByText('Reviewer · 代码审查 · 新代码复审',{exact:true})).toHaveCount(0);
  });
  test('an old approval cannot be substituted for the repaired-code review',async({page})=>{
    let firstReview: Record<string,unknown>|undefined,tampered=false;
    await page.routeWebSocket('**/api/team/socket',ws=>{const upstream=ws.connectToServer();upstream.onMessage(raw=>{
      const m=JSON.parse(String(raw));if(m.type==='delivery'&&m.delivery.role==='Reviewer'&&!firstReview)firstReview=JSON.parse(m.delivery.content);
      if(m.type==='result'){m.team.review={...firstReview,approved:true,issues:[]};tampered=true;}ws.send(JSON.stringify(m));
    });});
    await page.goto('/');await page.getByLabel('你想做什么？').fill('一次修复 旧批准替换');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByRole('heading',{name:'生成未完成'})).toBeVisible({timeout:65000});expect(tampered).toBe(true);
    await expect(page.getByText('项目已保存',{exact:true})).toHaveCount(0);await expect(page.locator('iframe')).toHaveCount(0);
  });

});
