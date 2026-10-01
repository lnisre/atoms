import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { acceptanceScenarios } from '../team/cross-app-scenarios';
import { crossAppFixture } from '../team/cross-app-fixture';
import { independentCheck } from '../team/independent-check';
for (const kind of ['todo', 'reading'] as const) {
  test(`${kind}: frozen independent core, defaults, unknown fields and failure/timing checks`, async ({ page }, testInfo) => {
    await page.goto('/');
    const proof = await independentCheck(page, crossAppFixture(kind, kind === 'reading'), acceptanceScenarios(kind, kind === 'reading'));
    writeFileSync(testInfo.outputPath('independent.json'), JSON.stringify(proof, null, 2));
    expect(proof.result.results.filter(r => r.status !== 'passed'), proof.result.detail).toEqual([]);
    expect(proof.result.status).toBe('passed');
  });
}
test('same frozen reading plan detects persistence loss and unknown-field loss', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  const html = crossAppFixture('reading', true), scenarios = acceptanceScenarios('reading', true);
  for (const broken of [html.replace('window.atoms.saveState(next)', 'Promise.resolve(next)'), html.replace('const next=structuredClone(state)', 'const next={books:structuredClone(state.books).map(({extra,...record})=>record)}')]) {
    const proof = await independentCheck(page, broken, scenarios);
    expect(proof.result.status).toBe('failed');
    expect(proof.result.results.some(r => r.status === 'failed' && r.command.op === 'data')).toBe(true);
  }
});

import { fulfillGeneration } from './team-fixture';
import { crossAppWorkflow } from '../team/cross-app-workflow';
for (const kind of ['reading', 'todo'] as const) test(`${kind}: same acceptance workflow with explicit offline responses`, async ({ context, baseURL }, testInfo) => {
  test.setTimeout(120000);
  let round = 0;
  await context.route('**/api/generate', route => fulfillGeneration(route, { json: {
    html: crossAppFixture(kind, round > 0, round++ > 1), model: 'OFFLINE FIXTURE', durationMs: 1, generatedAt: 'fixture', assistantReply: '明确标注的离线夹具，不是模型结果。',
  } }));
  await crossAppWorkflow(context, baseURL!, kind, (label, value) => writeFileSync(testInfo.outputPath(`${label}.json`), JSON.stringify(value, null, 2)));
});

test('bounded observation waits for the exact state and never passes an unmet expectation', async ({ page }) => {
  await page.goto('/');
  const proof = await independentCheck(page, crossAppFixture('todo'), [{ id: 'bounded-observation', seed: null, checks: [
    { id: 'ready', label: 'actual load settlement', command: { op: 'wait-for', selector: '[data-atoms-status]', property: 'text', equals: '已读取' } },
    { id: 'never', label: 'unmet condition remains failure', command: { op: 'wait-for', selector: '[data-atoms-status]', property: 'text', equals: '没有发生的保存' } },
  ] }]);
  expect(proof.result.results[0].status).toBe('passed');
  expect(proof.result.results[1]).toMatchObject({ status: 'failed', expected: '没有发生的保存', actual: '已读取' });
  expect(proof.result.status).toBe('failed');
});

import { repairWorkflow } from '../team/repair-workflow';
import { hash } from '../team/independent-check';
test('single repair acceptance driver verifies three artifacts and one modification using explicitly scripted reviews', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/');
  const baseline = await independentCheck(page, crossAppFixture('reading'), acceptanceScenarios('reading'));
  expect(baseline.result.status).toBe('passed');
  const proofPath = testInfo.outputPath('baseline.json'), injectionDir = testInfo.outputPath();
  writeFileSync(proofPath, JSON.stringify(baseline));
  const repaired = crossAppFixture('reading', true), rejected = repaired.replace('window.atoms.saveState(next)', 'Promise.resolve(next)');
  writeFileSync(testInfo.outputPath('engineer-before-injection.html'), repaired);
  writeFileSync(testInfo.outputPath('rejected.html'), rejected);
  await page.close();
  await context.route('**/api/generate', async route => {
    const taskId = route.request().headers()['x-atoms-task-id'], body = route.request().postDataJSON();
    const review = (html: string, approved: boolean) => ({ kind: 'code-review', schemaVersion: 1, resolutions: approved ? [{id:'save',codeQuote:'window.atoms.saveState(next)',explanation:'恢复真实保存'}] : [], taskId, codeHash: hash(html), approved, summary: 'OFFLINE SCRIPTED REVIEW', issues: approved ? [] : [{id:'save',severity:'major',category:'persistence',codeQuote:'Promise.resolve(next)',trigger:'add record',consequence:'not persisted'}] });
    const assign = (to: string) => ({ role: 'Mike', content: JSON.stringify({ command: 'assign', to }) });
    const deliver = (role: string, value: unknown) => ({ role, content: JSON.stringify(value) });
    const approved = review(repaired, true);
    const deliveries = [assign('Requirements'), deliver('Requirements', { requirements: [{ id: 'reading', description: 'OFFLINE FIXTURE' }] }),
      assign('Engineer'), deliver('Engineer', { codeHash: hash(rejected), iteration: 1 }), assign('Reviewer'), deliver('Reviewer', review(rejected, false)),
      assign('Engineer'), deliver('Engineer', { codeHash: hash(repaired), iteration: 2 }), assign('Reviewer'), deliver('Reviewer', approved), deliver('Mike', { command: 'finish' })];
    const team = { protocol: 'atoms-team/3', taskId, projectId: body.projectId, baseCodeHash: hash(body.baseHtml), codeHash: hash(repaired), review: approved, outcome: "passed", deliveries,
      calls: deliveries.map((d, i) => ({ call: i + 1, actor: d.role, requestedModel: 'OFFLINE FIXTURE', status: 'completed' })) };
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'session', protocol: 'atoms-team/3', taskId, projectId: body.projectId, token: 'offline-fixture', deadline: Date.now() + 240000 },
      { type: 'result', protocol: 'atoms-team/3', taskId, team, result: { html: repaired, model: 'OFFLINE FIXTURE', durationMs: 1, generatedAt: 'fixture' }, assistantReply: 'OFFLINE FIXTURE' },
    ].map(m => JSON.stringify(m)).join('\n') + '\n' });
  });
  await repairWorkflow(context, baseURL!, (label, value) => writeFileSync(testInfo.outputPath(`${label}.json`), JSON.stringify(value, null, 2)), { proofPath, injectionDir });
});
