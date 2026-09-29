import { expect, test, type Page } from "@playwright/test";
const html = `<!DOCTYPE html><html><head></head><body>
<div><label>任务<input aria-label="任务" disabled></label><button disabled>添加</button></div><ul></ul><p role="status"></p>
<script>
let items=[];const list=document.querySelector('ul'),input=document.querySelector('input'),button=document.querySelector('button'),status=document.querySelector('[role=status]');
function render(){list.replaceChildren();items.forEach(item=>{const row=document.createElement('li'),check=document.createElement('input'),text=document.createElement('span'),del=document.createElement('button');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label','完成 '+item.text);text.textContent=item.text;del.textContent='删除 '+item.text;check.onchange=()=>{item.done=check.checked;save()};del.onclick=()=>{items=items.filter(x=>x.id!==item.id);save()};row.append(check,text,del);list.append(row)})}
async function save(){render();try{await atoms.saveState(items);status.textContent='操作已保存'}catch(e){status.textContent=e.message}}
button.onclick=()=>{if(!input.value.trim())return;items.push({id:Date.now()+Math.random(),text:input.value,done:false});input.value='';save()};
atoms.loadState().then(state=>{items=state??[];render();input.disabled=button.disabled=false}).catch(e=>status.textContent=e.message);
</script></body></html>`;
const candidateHtml = (round: number) => html.replace('<body>', `<body><h1>候选第${round}轮</h1><label>优先级筛选<select><option>全部</option><option>普通</option></select></label>`);
async function setup(page: Page) {
  await page.route('**/api/generate', route => route.fulfill({ json: { html, model: 'fixture', durationMs: 1, generatedAt: 'original' } }));
  await page.goto('/');
  await page.getByLabel('你想做什么？').fill('候选隔离待办');
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
  const f = page.frameLocator('iframe');
  for (const text of ['原任务甲', '原任务乙']) {
    await f.getByLabel('任务', { exact: true }).fill(text);
    // Seed through the keyboard: newly mounted opaque frames can miss the first
    // compositor pointer event in headless Chrome (also recorded in the M1 baseline).
    await f.getByRole('button', { name: '添加', exact: true }).press('Enter');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  }
  await page.unroute('**/api/generate');
}
async function modify(page: Page, text = '增加优先级与筛选') {
  await page.getByLabel('追加修改需求').fill(text);
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
}
async function originalIntact(page: Page) {
  const f = page.frameLocator('iframe');
  await expect(f.getByText('原任务甲', { exact: true })).toBeVisible();
  await expect(f.getByLabel('完成 原任务乙', { exact: true })).not.toBeChecked();
  await expect(f.getByText('试用新增', { exact: true })).toHaveCount(0);
  await expect(f.getByRole('heading', { name: /候选第/ })).toHaveCount(0);
  await expect(page.getByLabel('本轮对话')).toHaveCount(0);
}
test('同项目多轮使用最新候选；试用增删改、失败、放弃、刷新和关闭重开均保全正式数据', async ({ page, context }) => {
  await setup(page);
  const url = page.url();
  const requests: Record<string, unknown>[] = [];
  let fail = false;
  let round = 0;
  await page.route('**/api/generate', route => {
    requests.push(route.request().postDataJSON());
    return fail ? route.fulfill({ status: 502, json: { error: '受控模型失败' } }) : route.fulfill({ json: { html: candidateHtml(++round), model: 'fixture', durationMs: 1, generatedAt: String(round) } });
  });
  await modify(page);
  const f = page.frameLocator('iframe');
  await expect(f.getByRole('heading', { name: '候选第1轮' })).toBeVisible();
  expect(requests[0].baseHtml).toBe(html);
  expect(requests[0].context).toEqual([]);
  await expect(page).toHaveURL(url);
  await f.getByLabel('任务', { exact: true }).fill('试用新增');
  await f.getByRole('button', { name: '添加', exact: true }).click();
  await f.getByRole('button', { name: '删除 原任务甲', exact: true }).click();
  await f.getByLabel('完成 原任务乙', { exact: true }).check();
  await expect(page.locator('.data-status')).toContainText('仅本轮会话有效');
  await expect(page.getByText('应用数据已保存', { exact: true })).toHaveCount(0);
  // Opening the same saved project while trial is alive proves no durable write occurred.
  const check = await context.newPage(); await check.goto(url); await originalIntact(check); await check.close();
  const oldChannel = await page.locator('iframe').evaluate(el => JSON.parse((el as HTMLIFrameElement).srcdoc.match(/const \{channel,origin\}=(.*?);/)![1]).channel);
  await modify(page, '把筛选放到顶部');
  await expect(f.getByRole('heading', { name: '候选第2轮' })).toBeVisible();
  expect(requests[1].baseHtml).toBe(candidateHtml(1));
  expect(requests[1].context).toEqual(['增加优先级与筛选']);
  await expect(f.getByText('试用新增', { exact: true })).toBeVisible();
  await expect(f.getByLabel('完成 原任务乙', { exact: true })).toBeChecked();
  fail = true; await modify(page, '再次修改');
  await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toContainText('受控模型失败');
  await expect(page.getByRole('button', { name: '生成候选', exact: true })).toBeEnabled();
  await expect(f.getByRole('heading', { name: '候选第2轮' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '放弃本轮修改' }).click();
  await originalIntact(page);
  // Even a current iframe source cannot use an obsolete trial channel for official writes.
  await f.locator('body').evaluate((_el, channel) => parent.postMessage({ type: 'atoms:state', channel, id: 999, method: 'save', state: [] }, '*'), oldChannel);
  await page.reload(); await originalIntact(page);
  await modify(page); await expect(f.getByRole('heading', { name: '候选第3轮' })).toBeVisible();
  await page.reload(); await originalIntact(page);
  await modify(page); await expect(f.getByRole('heading', { name: '候选第4轮' })).toBeVisible();
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(url); await originalIntact(reopened);
  await reopened.getByRole('button', { name: 'Atoms 首页' }).click();
  await expect(reopened.getByRole('region', { name: '已有项目' }).getByRole('button')).toHaveCount(1);
});
test('复制正式数据读取失败不开始空试用；手动重试可成功', async ({ page }) => {
  await setup(page);
  await page.route('**/api/generate', route => route.fulfill({ json: { html: candidateHtml(1), model: 'fixture', durationMs: 1, generatedAt: '1' } }));
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      IDBObjectStore.prototype.get = original;
      throw new DOMException(String(args[0]), 'UnknownError');
    };
  });
  await modify(page);
  await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toContainText('浏览器存储读写失败');
  await originalIntact(page);
  await page.getByRole('button', { name: '生成候选', exact: true }).click();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '候选第1轮' })).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('原任务甲', { exact: true })).toBeVisible();
});
test('修改超时结束等待，保留已采用应用供继续使用', async ({ page }) => {
  await setup(page);
  await page.route('**/api/generate', () => {});
  await page.clock.install();
  await modify(page);
  await page.clock.fastForward(136000);
  await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toContainText('等待超时');
  await originalIntact(page);
  await expect(page.getByRole('button', { name: '生成候选', exact: true })).toBeEnabled();
});

test('明确采用最新候选只保存代码与多轮记录；旧通道失效，正式操作和重开可恢复', async ({ page, context }) => {
  await setup(page);
  await expect(page.getByLabel('已采用修改记录')).toContainText('还没有');
  const url = page.url();
  const requests: Record<string, unknown>[] = [];
  let round = 0;
  await page.route('**/api/generate', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { html: candidateHtml(++round), model: 'fixture', durationMs: 1, generatedAt: String(round) } });
  });
  const f = page.frameLocator('iframe');
  await f.getByLabel('完成 原任务乙', { exact: true }).check();
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  await modify(page);
  await expect(f.getByRole('heading', { name: '候选第1轮' })).toBeVisible();
  await f.getByLabel('任务', { exact: true }).fill('试用新增');
  await f.getByRole('button', { name: '添加', exact: true }).press('Enter');
  await f.getByRole('button', { name: '删除 原任务甲', exact: true }).click();
  await f.getByLabel('完成 原任务乙', { exact: true }).uncheck();
  await modify(page, '把筛选放到顶部');
  await expect(f.getByRole('heading', { name: '候选第2轮' })).toBeVisible();
  const oldChannel = await page.locator('iframe').evaluate(el => JSON.parse((el as HTMLIFrameElement).srcdoc.match(/const \{channel,origin\}=(.*?);/)![1]).channel);
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByLabel('已采用修改记录')).toContainText('已采用 2 轮调整');
  await expect(page.getByLabel('已采用修改记录')).toContainText('增加优先级与筛选');
  await expect(page.getByLabel('已采用修改记录')).toContainText('把筛选放到顶部');
  await expect(page.getByLabel('本轮对话')).toHaveCount(0);
  await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
  await expect(page).toHaveURL(url);
  await expect(f.getByText('原任务甲', { exact: true })).toBeVisible();
  await expect(f.getByLabel('完成 原任务乙', { exact: true })).toBeChecked();
  await expect(f.getByText('试用新增', { exact: true })).toHaveCount(0);
  await f.locator('body').evaluate((_el, channel) => parent.postMessage({ type: 'atoms:state', channel, id: 999, method: 'save', state: [] }, '*'), oldChannel);
  await f.getByLabel('任务', { exact: true }).fill('正式新增');
  await f.getByRole('button', { name: '添加', exact: true }).press('Enter');
  await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
  await modify(page, '第三轮已采用修改');
  await expect(f.getByRole('heading', { name: '候选第3轮' })).toBeVisible();
  expect(requests[2].baseHtml).toBe(candidateHtml(2));
  expect(requests[2].context).toEqual([]);
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(2);
  await modify(page, '不保存的修改');
  await expect(f.getByRole('heading', { name: '候选第4轮' })).toBeVisible();
  await page.getByRole('button', { name: '放弃本轮修改' }).click();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(2);
  await modify(page, '刷新丢弃的修改');
  await expect(f.getByRole('heading', { name: '候选第5轮' })).toBeVisible();
  await page.reload();
  await expect(f.getByRole('heading', { name: '候选第3轮' })).toBeVisible();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(2);
  await expect(page.getByLabel('已采用修改记录')).not.toContainText('丢弃');
  await expect(f.getByText('正式新增', { exact: true })).toBeVisible();
  await expect(f.getByLabel('完成 原任务乙', { exact: true })).toBeChecked();
  let generations = 0;
  context.on('request', request => { if (request.url().endsWith('/api/generate')) generations++; });
  await page.close();
  const reopened = await context.newPage(); await reopened.goto('/');
  await reopened.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /候选隔离待办/ }).click();
  await expect(reopened).toHaveURL(url);
  await expect(reopened.frameLocator('iframe').getByRole('heading', { name: '候选第3轮' })).toBeVisible();
  await expect(reopened.frameLocator('iframe').getByText('正式新增', { exact: true })).toBeVisible();
  await expect(reopened.getByLabel('已采用修改记录').locator('li')).toHaveCount(2);
  expect(generations).toBe(0);
});

test('采用事务未完成不显示成功；中止保留候选和此前采用记录，可手动重试', async ({ page, context }) => {
  await setup(page);
  let round = 0;
  await page.route('**/api/generate', route => route.fulfill({ json: { html: candidateHtml(++round), model: 'fixture', durationMs: 1, generatedAt: String(round) } }));
  await modify(page, '先采用的修改');
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(1);
  await modify(page, '保存失败的修改');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '候选第2轮' })).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      const request = put.apply(this, args);
      const end = Date.now() + 1500;
      const hold = () => {
        if (Date.now() >= end) return this.transaction.abort();
        this.get('__keep_transaction_alive__').addEventListener('success', hold);
      };
      request.addEventListener('success', hold);
      return request;
    };
  });
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在保存采用…', exact: true })).toBeDisabled();
  await expect(page.getByText('候选试用 · 未采用')).toBeVisible();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(1);
  await expect(page.getByRole('region', { name: '对话修改' }).getByRole('alert')).toContainText('采用保存失败');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: '候选第2轮' })).toBeVisible();
  const check = await context.newPage(); await check.goto(page.url());
  await expect(check.frameLocator('iframe').getByRole('heading', { name: '候选第1轮' })).toBeVisible();
  await expect(check.getByLabel('已采用修改记录').locator('li')).toHaveCount(1);
  await expect(check.frameLocator('iframe').getByText('原任务甲', { exact: true })).toBeVisible();
  await check.close();
  await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByLabel('已采用修改记录').locator('li')).toHaveCount(2);
  await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
});
