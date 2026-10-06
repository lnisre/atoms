import assert from 'node:assert/strict';
import { test, expect } from '@playwright/test';
import { crossAppFixture } from '../team/cross-app-fixture';
import { acceptanceScenarios } from '../team/cross-app-scenarios';
import { independentCheck } from '../team/independent-check';
import { snapshot } from '../team/cross-app-workflow';
import { requireApplicationData } from '../team/project-observation';
import { expectVisibleRecords } from '../team/record-assertions';
import { fulfillGeneration } from './team-fixture';

// Deliberate synthetic variants. Historical generated HTML/requirements stay immutable.
const emptyState = crossAppFixture('reading', true).replace('list.append(li)}}',
  `list.append(li)}if(!list.children.length){const empty=document.createElement('li');empty.className='empty';empty.textContent='暂无阅读记录';list.append(empty)}}`);
const ignoredFilter = emptyState.replace("if(mode==='active'&&complete||mode==='complete'&&!complete)continue;", '');
const missingIdentity = ignoredFilter.replace('li.dataset.id=r.id;', "if(mode!=='active')li.dataset.id=r.id;");
for (const [variant, html, passes] of [
  ['empty-state', emptyState, true],
  ['ignored-filter', ignoredFilter, false],
  ['missing-identity', missingIdentity, false],
] as const) {
  test(`record assertion: ${variant}`, async ({ page }, info) => {
    await page.route('**/api/generate', route => fulfillGeneration(route, { json: { html, model: 'OFFLINE RECORD ASSERTION', durationMs: 1, generatedAt: 'fixture' } }));
    await page.goto('/');
    await page.getByLabel('你想做什么？').fill('合成记录断言反例');
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible();
    const frame = page.frameLocator('iframe');
    await frame.locator('#name').fill('正式保留');
    await frame.locator('#add').click();
    await expect(frame.locator('[data-atoms-status]')).toHaveText('已保存');
    await frame.locator('.toggle').click();
    await expect(frame.locator('[data-atoms-status]')).toHaveText('已保存');
    const before = await snapshot(page);
    const ids = (requireApplicationData(before, new URL(page.url()).searchParams.get('project')!).books as { id: string }[]).map(row => row.id);
    await expectVisibleRecords(frame, ['正式保留'], ids);
    await frame.locator('#filter').selectOption('active');
    if (passes) {
      await expect(frame.locator('#records li.empty')).toHaveText('暂无阅读记录');
      await expectVisibleRecords(frame, [], []);
    } else {
      await expect(frame.locator('#records .title:visible')).toHaveText(['正式保留']);
      if (variant === 'missing-identity') await expect(frame.locator('#records li[data-id]')).toHaveCount(0);
      await assert.rejects(() => expectVisibleRecords(frame, [], []), /toHaveText/);
    }
    expect((await snapshot(page)).data).toEqual(before.data);
    for (const mode of ['complete', 'all']) {
      await frame.locator('#filter').selectOption(mode);
      await expectVisibleRecords(frame, ['正式保留'], ids);
      expect((await snapshot(page)).data).toEqual(before.data);
    }
    // The independent QA plan has its own DOM membership + no-write assertions.
    const scenarios = acceptanceScenarios('reading', true).filter(s => s.id === 'filter-empty-preserves-records');
    expect(scenarios).toHaveLength(1);
    const proof = await independentCheck(page, html, scenarios);
    await info.attach('independent-filter-proof', { body: JSON.stringify(proof), contentType: 'application/json' });
    expect(proof.result.status).toBe(passes ? 'passed' : 'failed');
    if (!passes) expect(proof.result.results.some(row => row.status === 'failed' && row.command.op === 'assert' && row.command.selector === '#records .title')).toBe(true);
  });
}
