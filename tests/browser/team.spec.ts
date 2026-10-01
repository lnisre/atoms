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
  test('Reviewer rejection ends the task without delivery or a saved project',async({page})=>{
    await page.goto('/');await page.getByLabel('你想做什么？').fill('审查拒绝受控验证');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByRole('heading',{name:'生成未完成'})).toBeVisible({timeout:65000});
    await expect(page.getByText(/代码审查：未通过/)).toBeVisible();
    await expect(page.getByText('项目已保存',{exact:true})).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
  });

});
