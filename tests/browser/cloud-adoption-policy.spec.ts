import { test, expect, type Page } from '@playwright/test';
import { fixture, generate, frame, ready, modify } from '../helpers/cloud-browser-fixture';
import type { ReviewIssue } from '../../src/lib/team/review';
const finding:ReviewIssue={id:'duplicate-save-on-change',severity:'minor',category:'persistence',codeQuote:'state.count++',trigger:'输入后失焦',consequence:'重复保存相同内容，不造成数据丢失或错误结果'};
async function adopt(page:Page){await modify(page);await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toHaveCount(0);}
async function increment(page:Page){const button=frame(page).getByRole('button',{name:'增加',exact:true});await expect.poll(async()=>{await button.hover();return button.evaluate(el=>el.matches(':hover'));}).toBe(true);await button.click();await expect(frame(page).locator('#status')).toHaveText('更新完成');}

test('after restoring V2 a minor persistence candidate can be adopted with formal data intact',async({page,context},info)=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 await increment(page);await adopt(page);await adopt(page);
 await page.getByRole('button',{name:'历史保存点',exact:true}).click();await page.getByRole('button',{name:'恢复到 V2',exact:true}).click();await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect(frame(page).getByRole('heading',{name:'Counter 2'})).toBeVisible();await expect(page.getByRole('button',{name:'撤销本次恢复',exact:true})).toBeEnabled();
 store.reviewIssues([finding]);await modify(page);
 await expect(page.getByText('审查仍有待修复问题，可试用后采用；问题记录会随版本保留。',{exact:true})).toBeVisible();
 await increment(page);await expect(frame(page).locator('#count')).toHaveText('2');
 await page.getByRole('button',{name:'采用修改',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('minor-adoption-after-restore.png')});
 await page.getByRole('button',{name:'采用修改',exact:true}).click();await expect(page.getByRole('button',{name:'撤销本次恢复',exact:true})).toHaveCount(0);
 await expect(frame(page).getByRole('heading',{name:'Counter 4'})).toBeVisible();await expect(frame(page).locator('#count')).toHaveText('1');
 const cloud=[...store.rows.values()][0].cloud;expect(cloud.project.previewPolicy?.adoption).toBe('allowed');expect(cloud.project.modificationRecords).toHaveLength(2);expect(cloud.state).toEqual({count:1});
 await page.reload();await expect(frame(page).getByRole('heading',{name:'Counter 4'})).toBeVisible();
 store.reviewIssues([]);await modify(page);await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
});
for(const [category,severity] of [['persistence','major'],['data-loss','minor']] as const){
 test(`${severity} ${category} keeps adoption blocked with specific consequence`,async({page,context},info)=>{
  const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
  store.reviewIssues([{...finding,category,severity,consequence:'保存后可能丢失已有字段'}]);
  await page.getByLabel('追加修改需求').fill('change');await page.getByRole('button',{name:'生成候选',exact:true}).click();
  const button=page.getByRole('button',{name:'采用修改',exact:true});await expect(button).toBeDisabled();
  await expect(page.getByRole('status').filter({hasText:'数据丢失或重大保存风险'})).toContainText('保存后可能丢失已有字段');
  await button.scrollIntoViewIfNeeded();await expect(page.getByRole('status').filter({hasText:'数据丢失或重大保存风险'})).toBeInViewport();await page.screenshot({path:info.outputPath('risk-blocked.png')});
  expect([...store.rows.values()][0].cloud.version.code).toBe(1);
 });
}
test('missing proof and generation in progress explain disabled adoption without claiming data risk',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();await modify(page);
 store.holdGeneration();await page.getByLabel('追加修改需求').fill('another change');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();await expect(page.getByText('正在生成新的候选，请等待生成结束后再采用。',{exact:true})).toBeVisible();store.releaseGeneration();
 await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeEnabled();
 store.withoutProof();await page.getByLabel('追加修改需求').fill('no proof');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'缺少可信保存证明'})).toBeVisible();await expect(page.getByRole('button',{name:'采用修改',exact:true})).toBeDisabled();
 await expect(page.getByText('存在执行或数据风险，当前不能采用。可以继续修改。',{exact:true})).toHaveCount(0);
});

test('execution blocking gives its exact reason and cannot be adopted',async({page,context})=>{
 const store=await fixture();await store.connect(context);await generate(page);await expect(ready(page)).toBeVisible();
 store.render(()=>'<html><head></head><body><script>while(true){}</script></body></html>');
 await page.getByLabel('追加修改需求').fill('blocked execution');await page.getByRole('button',{name:'生成候选',exact:true}).click();
 const adoption=page.getByRole('button',{name:'采用修改',exact:true});await expect(adoption).toBeDisabled();
 await expect(adoption).toHaveAccessibleDescription(/当前候选存在执行阻断，修复后才能采用。.*检测到载入时无条件空循环/);
 await expect(page.getByRole('heading',{name:'此代码暂不执行'})).toBeVisible();expect([...store.rows.values()][0].cloud.version.code).toBe(1);
});
