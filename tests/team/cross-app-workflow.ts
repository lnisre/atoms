import assert from 'node:assert/strict';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { syntheticRequirement, readingChanges, acceptanceScenarios, appContract, type AppKind } from './cross-app-scenarios';
import { independentCheck, hash } from './independent-check';
import { expectVisibleRecords } from './record-assertions';

import { applicationDataFor, expectInitialHistoryPreserved, initialDisposition, projectById, requireApplicationData, type Snapshot } from './project-observation';

export type CrossAppOptions = { initialDraft?: 'stop' | 'use-synthetic' };
export async function snapshot(page: Page): Promise<Snapshot> {
  return JSON.parse(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('atoms-projects', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      // Keep browser callbacks self-contained under node --import tsx (no named local functions).
      const activeId = new URLSearchParams(location.search).get('project');
      const projects = (await new Promise<Record<string, unknown>[]>((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); })).sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
      const data = (await new Promise<Record<string, unknown>[]>((resolve, reject) => { const r = db.transaction('applicationData').objectStore('applicationData').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); })).sort((a, b) => Number(b.projectId === activeId) - Number(a.projectId === activeId));
      return JSON.stringify({ projects, data });
    } finally { db.close(); }
  }));
}
export async function crossAppWorkflow(context: BrowserContext, base: string, kind: AppKind, evidence: (label: string, value: unknown) => void, options: CrossAppOptions = {}) {
  let page = await context.newPage();
  const requests: { body: { projectId: string; requirement: string; baseHtml?: string; context?: string[] }; taskId?: string }[] = [];
  const operations: string[] = [], c = appContract(kind);
  context.on('request', r => {
    if (new URL(r.url()).pathname === '/api/generate') {
      // No assertion in an event callback: retain a violation and fail at the end.
      requests.push({ body: r.postDataJSON(), taskId: r.headers()['x-atoms-task-id'] });
    }
  });
  await context.route('**/api/generate', async route => {
    if ((route.request().postData() ?? '').includes('SYNTHETIC_PRIVATE')) { await route.abort('blockedbyclient'); return; }
    await route.fallback();
  });
  const savedLogs = () => expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toBeHidden();
  const frame = () => page.frameLocator('iframe');
  const settle = () => expect(frame().locator('[data-atoms-status]')).toHaveText('已保存');
  const add = async (name: string) => { await frame().locator('#name').fill(name); await frame().locator('#add').click(); await settle(); operations.push(`add:${name}`); };
  const checkCode = async (html: string, rated: boolean, label: string) => {
    const before = await snapshot(page), checkPage = await context.newPage();
    try {
      await checkPage.goto(base);
      const proof = await independentCheck(checkPage, html, acceptanceScenarios(kind, rated));
      evidence(label, proof);
      assert.equal(proof.result.status, 'passed', `${label}: ${proof.result.detail}: ${JSON.stringify(proof.result.results.filter(r => r.status !== 'passed'))}`);
      assert.deepEqual((await snapshot(page)).data, before.data, 'independent checks changed formal data');
    } finally { await checkPage.close(); }
  };
  const modify = async (index: number) => {
    await page.getByLabel('追加修改需求').fill(readingChanges[index]);
    await page.getByRole('button', { name: '生成候选', exact: true }).click();
    await Promise.race([
      page.getByText(`第 ${index + 1} 轮候选 · 等待采用`, { exact: true }).waitFor({ timeout: 250_000 }),
      page.getByRole('region', { name: '对话修改' }).getByRole('alert').waitFor({ timeout: 250_000 }).then(async () => { throw new Error(await page.getByRole('region', { name: '对话修改' }).getByRole('alert').innerText()); }),
    ]);
  };
  try {
    await page.goto(base);
    await page.getByLabel('你想做什么？').fill(syntheticRequirement(kind));
    await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
    const workspaceBefore = await snapshot(page);
    await page.getByRole('button', { name: '开始生成' }).click();
    await Promise.race([
      page.getByText('项目已保存', { exact: true }).waitFor({ timeout: 250_000 }),
      page.locator('.task-state.failed').waitFor({ timeout: 250_000 }),
    ]);
    await savedLogs();
    assert.equal(requests.length, 1, 'Expected exactly one initial generation request');
    const { projectId } = requests[0].body, taskId = requests[0].taskId;
    assert(taskId && projectId, 'Missing submitted task/project identity');
    assert(!workspaceBefore.projects.some(project => project.id === projectId), 'Expected a fresh synthetic project');
    const retained = await snapshot(page), disposition = initialDisposition(retained, projectId, taskId);
    evidence('initial-disposition', { ...disposition, requestedAction: options.initialDraft ?? 'stop',
      ...(disposition.kind === 'no-artifact' ? { terminalText: await page.locator('.task-state.failed').innerText() } : {}) });
    evidence('initial-storage', retained);
    if (disposition.kind === 'no-artifact') throw new Error(`Initial task has no retained artifact: ${await page.locator('.task-state.failed').innerText()}`);
    assert.equal(new URL(page.url()).searchParams.get('project'), projectId, 'URL/project request mismatch');
    const original = projectById(retained, projectId);
    if (disposition.kind === 'execution-blocked' || disposition.kind === 'draft-restricted') {
      if (disposition.kind === 'execution-blocked') await expect(page.locator('iframe')).toHaveCount(0);
      else await expect(page.getByRole('button', { name: '使用此版本', exact: true })).toBeDisabled();
      throw new Error(`Initial artifact is ${disposition.kind}; formal lifecycle refused`);
    }
    if (disposition.kind === 'draft-usable') {
      if (options.initialDraft !== 'use-synthetic') throw new Error('Initial artifact is draft-usable; explicit use-synthetic option required');
      assert.equal(original.requirement, syntheticRequirement(kind), 'Explicit first use is limited to this synthetic scenario');
      assert.equal(applicationDataFor(retained, projectId), undefined, 'Fresh draft must have no formal business row');
      await checkCode(original.draftResult!.html, false, `${kind}-draft-independent`);
      await add('首次仅试用');
      await expectVisibleRecords(frame(), ['首次仅试用']);
      await savedLogs();
      const trial = await snapshot(page);
      assert.deepEqual(trial.data, retained.data, 'First trial wrote formal data');
      expectInitialHistoryPreserved(original, projectById(trial, projectId));
      evidence('draft-trial', trial);
      await page.reload();
      await expect(frame().locator('[data-atoms-status]')).toHaveText('已读取');
      await expectVisibleRecords(frame(), [], []);
      assert.deepEqual((await snapshot(page)).data, retained.data);
      assert.equal(initialDisposition(await snapshot(page), projectId, taskId).kind, 'draft-usable');
      // Leave nonempty trial data at activation to prove it is not promoted.
      await add('首次仅试用'); await savedLogs();
      const beforeUse = projectById(await snapshot(page), projectId);
      await page.getByRole('button', { name: '使用此版本', exact: true }).click();
      await expect(page.getByText('运行预览 · 已采用应用', { exact: true })).toBeVisible();
      await expect(frame().locator('[data-atoms-status]')).toHaveText('已读取');
      await expectVisibleRecords(frame(), [], []); await savedLogs();
      const activated = await snapshot(page), used = projectById(activated, projectId);
      assert.equal(initialDisposition(activated, projectId, taskId).kind, 'formal');
      assert.equal(hash(used.result.html), disposition.codeHash);
      assert.equal(used.draftResult, undefined);
      assert.deepEqual(activated.data, retained.data, 'Explicit first use copied trial data');
      expectInitialHistoryPreserved(beforeUse, used);
      evidence('explicit-first-use', { before: beforeUse, after: used, data: activated.data, action: 'UI 使用此版本', initialTaskOutcome: disposition.taskOutcome });
    }
    const lifecycle = { initialDisposition: disposition.kind, initialTaskOutcome: disposition.taskOutcome,
      path: disposition.kind === 'formal' ? 'formal-from-generation' : 'explicit-retained-artifact-continuation' };
    evidence('lifecycle', lifecycle);
    await add('正式保留'); await add('正式删除');
    await frame().locator('#records li[data-id] .remove').last().click(); await settle();
    await frame().locator('#records li[data-id] .toggle').first().click(); await settle();
    await frame().locator('#records li[data-id] .toggle').first().click(); await settle();
    const initial = await snapshot(page), project = projectById(initial, projectId);
    const formalIds = (requireApplicationData(initial, projectId)[c.collection] as { id: string }[]).map(row => row.id);
    await expectVisibleRecords(frame(), ['正式保留'], formalIds);
    await checkCode(project.result.html, false, `${kind}-initial-independent`);
    // Only this new synthetic project is touched; no existing user profile is opened.
    await page.evaluate(async ({ id, collection, stateKey }) => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('atoms-projects', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('applicationData', 'readwrite'), store = tx.objectStore('applicationData');
        store.get(id).onsuccess = e => {
          const row = (e.target as IDBRequest).result;
          row.state.unknown = { marker: 'SYNTHETIC_PRIVATE_ROOT' };
          row.state[collection][0].extra = { marker: 'SYNTHETIC_PRIVATE_RECORD' };
          delete row.state[collection][0][stateKey];
          store.put(row);
        };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close();
    }, { id: project.id, collection: c.collection, stateKey: c.state });
    await page.reload(); await expectVisibleRecords(frame(), ['正式保留'], formalIds);
    const official = await snapshot(page);
    assert.deepEqual(requireApplicationData(official, projectId).unknown, { marker: 'SYNTHETIC_PRIVATE_ROOT' });
    if (kind === 'reading') {
      await modify(0);
      await expect(frame().locator('.score')).toHaveValue('0');
      await frame().locator('.score').selectOption('4'); await settle();
      await add('仅试用');
      assert.deepEqual((await snapshot(page)).data, official.data);
      await modify(1);
      await expectVisibleRecords(frame(), ['正式保留', '仅试用']);
      await expect(frame().locator('.score').first()).toHaveValue('4');
      assert(await frame().locator('#filter').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('#records')!) & Node.DOCUMENT_POSITION_FOLLOWING)), 'filter not above list');
      assert.equal(requests[1].body.baseHtml, project.result.html);
      assert.deepEqual(requests[2].body.context, [readingChanges[0]]);
      await checkCode(requests[2].body.baseHtml!, true, 'reading-first-candidate-independent');
      assert.deepEqual((await snapshot(page)).data, official.data);
      await page.getByRole('button', { name: '采用修改', exact: true }).click();
      await expect(page.getByText('运行预览 · 已采用应用', { exact: true })).toBeVisible(); await savedLogs();
      await expectVisibleRecords(frame(), ['正式保留'], formalIds); await expect(frame().locator('.score')).toHaveValue('0');
      const adopted = await snapshot(page), adoptedProject = projectById(adopted, projectId), record = adoptedProject.modificationRecords![0];
      assert.deepEqual(adopted.data, official.data);
      assert.deepEqual(adoptedProject.initialGeneration, projectById(official, projectId).initialGeneration);
      assert.deepEqual(record.requests, readingChanges);
      assert.equal(record.generations!.length, 2);
      assert.equal(record.generations![0].team!.codeHash, hash(requests[2].body.baseHtml!));
      assert.equal(record.generations![1].team!.codeHash, hash(adoptedProject.result.html));
      await checkCode(adoptedProject.result.html, true, 'reading-adopted-independent');
      await frame().locator('.score').selectOption('3'); await settle();
      await frame().locator('#records li[data-id] .toggle').click(); await settle();
      const beforeFilter = await snapshot(page);
      for (const mode of ['active', 'complete', 'all']) {
        await frame().locator('#filter').selectOption(mode);
        await expectVisibleRecords(frame(), mode === 'active' ? [] : ['正式保留'], mode === 'active' ? [] : formalIds);
        assert.deepEqual((await snapshot(page)).data, beforeFilter.data, `${mode} filter changed formal data`);
      }
    } else { await frame().locator('#records li[data-id] .toggle').click(); await settle(); }
    const beforeReopen = await snapshot(page), count = requests.length, url = page.url();
    await page.reload(); await expectVisibleRecords(frame(), ['正式保留'], formalIds);
    assert.deepEqual((await snapshot(page)).data, beforeReopen.data);
    await page.close(); page = await context.newPage(); await page.goto(url);
    await expectVisibleRecords(frame(), ['正式保留'], formalIds);
    await expect(frame().locator('#records li .title')).toHaveText('正式保留');
    if (kind === 'reading') await expect(frame().locator('.score')).toHaveValue('3');
    const final = await snapshot(page);
    assert.deepEqual(final, beforeReopen); assert.equal(requests.length, count);
    assert(!JSON.stringify(requests).includes('SYNTHETIC_PRIVATE'), 'business marker leaked to generation input');
    assert.equal(requests.length, kind === 'reading' ? 3 : 1);
    expectInitialHistoryPreserved(original, projectById(final, projectId));
    evidence('stored-project', final);
    evidence('workflow', { kind, ...lifecycle, projectId, operations, restorationModelRequests: 0, generationRequests: requests.map(r => ({ ...r, body: { ...r.body, baseHtml: r.body.baseHtml ? hash(r.body.baseHtml) : undefined } })) });
    return final;
  } catch (error) {
    evidence('failure-page', page.isClosed() ? 'page closed' : await page.locator('body').innerText());
    throw error;
  } finally { if (!page.isClosed()) await page.close(); }
}
