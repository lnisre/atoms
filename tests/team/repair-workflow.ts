import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expect, type BrowserContext } from '@playwright/test';
import { acceptanceScenarios, readingChanges, syntheticRequirement } from './cross-app-scenarios';
import { snapshot } from './cross-app-workflow';
import { independentCheck, hash } from './independent-check';
import { artifactTeam } from '../../src/lib/team/review';

// A single modification task, using ONLY an earlier synthetic reading proof.
// The provider-side test launcher injects the defect; this driver cannot repair it.
export async function repairWorkflow(context: BrowserContext, base: string, evidence: (label: string, value: unknown) => void, paths = { proofPath: process.env.TEAM_REPAIR_BASELINE, injectionDir: process.env.ATOMS_DEFECT_EVIDENCE_DIR }) {
  const { proofPath, injectionDir } = paths;
  if (!proofPath || !injectionDir) throw new Error('Require a synthetic initial reading proof and dedicated injection evidence directory');
  const prior = JSON.parse(readFileSync(proofPath, 'utf8'));
  assert.equal(prior.result.status, 'passed');
  assert.equal(hash(prior.request.html), prior.request.codeHash);
  assert.equal(prior.request.planHash, hash(JSON.stringify(acceptanceScenarios('reading', false))));
  const page = await context.newPage();
  await context.route('**/api/generate', async route => {
    if ((route.request().postData() ?? '').includes('REPAIR_PRIVATE')) return route.abort('blockedbyclient');
    await route.fallback();
  });
  let requests = 0;
  context.on('request', r => { if (new URL(r.url()).pathname === '/api/generate') requests++; });
  try {
    await page.goto(base);
    await page.evaluate(async ({ html, requirement }) => {
      const db = await new Promise<IDBDatabase>(resolve => {
        const r = indexedDB.open('atoms-projects', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('applicationData', { keyPath: 'projectId' }); };
        r.onsuccess = () => resolve(r.result);
      });
      const id = crypto.randomUUID(), updatedAt = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['projects', 'applicationData'], 'readwrite');
        tx.objectStore('projects').put({ id, title: '合成阅读返工验收', requirement, updatedAt, result: { html, model: 'prior synthetic real artifact', durationMs: 0, generatedAt: updatedAt } });
        tx.objectStore('applicationData').put({ projectId: id, updatedAt, state: { books: [{ id: 'old', name: '返工原记录', extra: 'REPAIR_PRIVATE_RECORD' }], unknown: 'REPAIR_PRIVATE_ROOT' } });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close();
    }, { html: prior.request.html, requirement: syntheticRequirement('reading') });
    await page.reload();
    await page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /合成阅读返工验收/ }).click();
    await expect(page.frameLocator('iframe').locator('#records li')).toHaveCount(1);
    const original = await snapshot(page);
    await page.getByLabel('追加修改需求').fill(readingChanges[0]);
    await page.getByRole('button', { name: '生成候选', exact: true }).click();
    await Promise.race([
      page.getByText('第 1 轮候选 · 等待采用', { exact: true }).waitFor({ timeout: 250000 }),
      page.getByRole('region', { name: '对话修改' }).getByRole('alert').waitFor({ timeout: 250000 }).then(async () => { throw new Error(await page.getByRole('region', { name: '对话修改' }).getByRole('alert').innerText()); }),
    ]);
    assert.deepEqual((await snapshot(page)).data, original.data);
    await page.frameLocator('iframe').locator('.score').selectOption('4');
    await expect(page.frameLocator('iframe').locator('[data-atoms-status]')).toHaveText('已保存');
    await page.getByRole('button', { name: '采用修改', exact: true }).click();
    await expect(page.getByText('运行预览 · 已采用应用', { exact: true })).toBeVisible();
    await expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toBeHidden();
    const adopted = await snapshot(page), final = adopted.projects[0], team = final.modificationRecords![0].generations![0].team!;
    assert.deepEqual(adopted.data, original.data);
    assert(artifactTeam(team, hash(final.result.html), true));
    assert.equal(team.deliveries.filter(d => d.role === 'Engineer').length, 2);
    const reviews = team.deliveries.filter(d => d.role === 'Reviewer').map(d => JSON.parse(d.content));
    assert.equal(reviews.length, 2); assert.equal(reviews[0].approved, false); assert.equal(reviews[1].approved, true);
    const plans = acceptanceScenarios('reading', true), checks = await context.newPage();
    try {
      await checks.goto(base);
      for (const [label, html, expected] of [
        ['before-injection', readFileSync(`${injectionDir}/engineer-before-injection.html`, 'utf8'), 'passed'],
        ['rejected', readFileSync(`${injectionDir}/rejected.html`, 'utf8'), 'failed'],
        ['repaired', final.result.html, 'passed'],
      ]) {
        const proof = await independentCheck(checks, html, plans); evidence(label, proof);
        assert.equal(proof.result.status, expected, `${label}: ${proof.result.detail}`);
      }
    } finally { await checks.close(); }
    await expect(page.frameLocator('iframe').locator('.score')).toHaveValue('0');
    await page.frameLocator('iframe').locator('.score').selectOption('3');
    await expect(page.frameLocator('iframe').locator('[data-atoms-status]')).toHaveText('已保存');
    const saved = await snapshot(page); await page.reload();
    await expect(page.frameLocator('iframe').locator('.score')).toHaveValue('3');
    assert.deepEqual((await snapshot(page)).data, saved.data); assert.equal(requests, 1);
    evidence('repair-workflow', { team, requests, modelRequestsOnRestore: 0, stored: saved });
  } finally { await page.close(); }
}
