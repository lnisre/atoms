import { expect, test } from "@playwright/test";
import { fulfillGeneration } from "./team-fixture";
const html = '<!DOCTYPE html><html><head></head><body><h1>已保存原应用</h1></body></html>';
test.describe('modification through the shared native team', () => {
  test.skip(process.env.TEAM_FIXTURE !== '1', 'Explicit scripted provider required');
  test.setTimeout(120000);
  test('repair, refusal, malformed review, clarification and stop preserve candidate; adopt and reopen retain actual records', async ({page}) => {
    await page.route('**/api/generate', r => fulfillGeneration(r,{json:{html,model:'fixture',durationMs:1,generatedAt:'original'}}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('受控计数器');await page.getByRole('button',{name:'开始生成'}).click();
    await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();
    await page.unroute('**/api/generate');
    const requests: Record<string,unknown>[]=[];
    page.on('request',r=>{if(r.url().endsWith('/api/generate')) requests.push(r.postDataJSON())});
    const modify = async (text:string) => {await page.getByLabel('追加修改需求').fill(text);await page.getByRole('button',{name:'生成候选',exact:true}).click()};
    await modify('一次修复');
    await expect(page.getByText('第 1 轮候选 · 等待采用')).toBeVisible({timeout:45000});
    await expect(page.getByLabel('本轮对话').getByText('Reviewer · 代码审查 · 新代码复审',{exact:true})).toBeVisible();
    await page.frameLocator('iframe').getByRole('button',{name:'增加',exact:true}).click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    const source=await page.locator('iframe').getAttribute('srcdoc');
    for (const [change,outcome] of [['审查拒绝','审查未通过'],['格式纠正 持续无效','执行失败'],['关键歧义','需要补充需求']]) {
      await modify(change);await expect(page.getByLabel('本轮对话').getByText(outcome,{exact:true})).toBeVisible({timeout:45000});
      await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeEnabled();
      expect(await page.locator('iframe').getAttribute('srcdoc')).toBe(source);
      await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    }
    await expect(page.getByLabel('追加修改需求')).toHaveValue(/此前问题：[\s\S]*用户补充：/);
    await modify('一次修复 停止返工');
    await expect(page.getByRole('region',{name:'本轮修改记录'}).last().getByText(/Reviewer · 模型请求 10/)).toBeVisible({timeout:45000});
    await page.getByRole('button',{name:'停止任务',exact:true}).click();
    await expect(page.getByRole('button',{name:'生成候选',exact:true})).toBeEnabled();
    expect(await page.locator('iframe').getAttribute('srcdoc')).toBe(source);
    await modify('关键歧义 用户补充：允许负数，归零');
    await expect(page.getByText('第 2 轮候选 · 等待采用')).toBeVisible({timeout:45000});
    expect(requests.at(-1)!.context).toEqual(['一次修复']);
    expect(requests.at(-1)!.baseHtml).toBe(requests[1].baseHtml);
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await page.getByRole('button',{name:'采用修改',exact:true}).click();
    await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');
    const count=requests.length;await page.reload();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('0');expect(requests).toHaveLength(count);
    await expect(page.getByLabel('已采用修改记录').getByText('Reviewer · 代码审查 · 新代码复审',{exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'已保存修改记录',exact:true})).toHaveCount(2);
  });
  test('wrong base identity, wrong task and invalid terminal cannot replace an existing candidate', async ({page}) => {
let corruption='base';
    await page.routeWebSocket('**/api/team/socket',ws=>{const upstream=ws.connectToServer();upstream.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='result'){if(corruption==='base')m.team.baseCodeHash='0'.repeat(64);else if(corruption==='task')m.taskId=crypto.randomUUID();else m.team.deliveries.pop();}ws.send(JSON.stringify(m))})});
    await page.route('**/api/generate',r=>fulfillGeneration(r,{json:{html,model:'fixture',durationMs:1,generatedAt:'original'}}));
    await page.goto('/');await page.getByLabel('你想做什么？').fill('受控计数器');await page.getByRole('button',{name:'开始生成'}).click();await expect(page.getByText('项目已保存',{exact:true})).toBeVisible();
    await page.getByLabel('追加修改需求').fill('有效候选');await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByText('第 1 轮候选 · 等待采用')).toBeVisible();
    await page.unroute('**/api/generate');
    const source=await page.locator('iframe').getAttribute('srcdoc');
    for (const mode of ['base','task','terminal']) {corruption=mode;await page.getByLabel('追加修改需求').fill(mode);await page.getByRole('button',{name:'生成候选',exact:true}).click();await expect(page.getByRole('region',{name:'对话修改'}).getByRole('alert')).toBeVisible({timeout:45000});expect(await page.locator('iframe').getAttribute('srcdoc')).toBe(source);}
  });
});
