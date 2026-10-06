import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, test, type Route } from '@playwright/test';
import type { TeamRecord, Delivery } from '../../src/lib/team/contract';
import type { ClassifiedReview } from '../../src/lib/team/review';
import { crossAppFixture } from '../team/cross-app-fixture';
import { crossAppWorkflow, snapshot } from '../team/cross-app-workflow';
import { hash } from '../team/independent-check';
import { applicationDataFor, initialDisposition, projectById, requireApplicationData, type Snapshot } from '../team/project-observation';
import { fulfillGeneration } from './team-fixture';

type Mode = 'unreviewed' | 'data-risk' | 'execution-blocked' | 'no-artifact';
// Protocol seam only: real UI, policy calculation, preview bridge and IndexedDB.
// The failed Leader / absent Reviewer is scripted, never a new model observation.
async function initialFixture(route: Route, mode: Mode) {
  const input = route.request().postDataJSON(), taskId = route.request().headers()['x-atoms-task-id'];
  let html = crossAppFixture('reading');
  if (mode === 'execution-blocked') html = html.replace('<script>', '<script>while(true){};');
  const codeHash = hash(html);
  const deliver = (role: Delivery['role'], value: unknown): Delivery => ({ role, content: JSON.stringify(value) });
  const assign = (to: string) => deliver('Mike', { command: 'assign', to });
  const deliveries = [assign('Requirements'), deliver('Requirements', { requirements: [{ id: 'reading', description: 'OFFLINE SCRIPTED SPEC' }] }),
    assign('Engineer'), deliver('Engineer', { iteration: 1, codeHash })];
  let review: ClassifiedReview | undefined;
  if (mode === 'data-risk' || mode === 'execution-blocked') {
    review = { kind: 'code-review', schemaVersion: 1, taskId, codeHash, approved: mode === 'execution-blocked', summary: 'OFFLINE SCRIPTED REVIEW', resolutions: [],
      issues: mode === 'data-risk' ? [{ id: 'save-risk', severity: 'major', category: 'persistence', codeQuote: 'window.atoms.saveState(next)', trigger: 'fixture risk', consequence: 'scripted persistence risk, not a model finding' }] : [] };
    deliveries.push(assign('Reviewer'), deliver('Reviewer', review), deliver('Mike', { command: 'finish' }));
  }
  const outcome = mode === 'unreviewed' || mode === 'no-artifact' ? 'failed' : mode === 'data-risk' ? 'issues' : 'passed';
  const team: TeamRecord = { protocol: 'atoms-team/3', taskId, projectId: input.projectId, codeHash, deliveries, review, outcome,
    calls: deliveries.map((delivery, i) => ({ call: i + 1, actor: delivery.role, requestedModel: 'OFFLINE SCRIPTED', status: 'completed' })) };
  if (mode === 'unreviewed') team.calls.push({ call: team.calls.length + 1, actor: 'Mike', requestedModel: 'OFFLINE SCRIPTED', status: 'failed' });
  const terminal = mode === 'no-artifact'
    ? { type: 'error', protocol: 'atoms-team/3', taskId, outcome: 'failed', error: 'OFFLINE no artifact failure' }
    : { type: outcome === 'failed' ? 'error' : 'result', protocol: 'atoms-team/3', taskId, team, outcome, error: outcome === 'failed' ? 'OFFLINE Leader failed before Reviewer' : undefined,
      result: { html, model: 'OFFLINE FIXTURE', durationMs: 1, generatedAt: 'fixture' }, assistantReply: '离线协议夹具；不代表真实模型通过。' };
  await route.fulfill({ contentType: 'application/x-ndjson', body: [
    { type: 'session', protocol: 'atoms-team/3', taskId, projectId: input.projectId, token: 'offline-fixture' }, terminal,
  ].map(message => JSON.stringify(message)).join('\n') + '\n' });
}

test.beforeEach(async ({ context, page, baseURL }) => {
  // Count/block unexpected provider or external traffic instead of relying on a mode label.
  const unexpected: string[] = [], errors: string[] = [];
  context.on('page', opened => opened.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin || url.pathname.startsWith('/api/')) {
      unexpected.push(url.origin + url.pathname); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.route('**/api/team', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await page.getByLabel('你想做什么？').fill('precondition');
  await expect(page.getByRole('button', { name: '开始生成' })).toBeEnabled();
  // Explicit legacy-project precondition: a decoy business row plus workspace metadata.
  // It is never an activation seed and must remain byte-for-byte unchanged.
  await page.evaluate(async html => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('atoms-projects', 1); request.onsuccess = () => resolve(request.result); });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['projects', 'applicationData'], 'readwrite');
        tx.objectStore('projects').put({ id: '00000000-0000-4000-8000-000000000040', title: '离线无关项目', requirement: 'unrelated fixture', updatedAt: '2026-01-01', result: { html, model: 'OFFLINE', durationMs: 0, generatedAt: 'fixture' } });
        tx.objectStore('applicationData').put({ projectId: '00000000-0000-4000-8000-000000000040', state: { books: [{ id: 'unrelated', name: '无关正式记录' }] } });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, crossAppFixture('reading'));
  await page.close();
  // Hook is registered per test; teardown also runs on a rejected driver branch.
  test.info().annotations.push({ type: 'mode', description: 'offline protocol fixture; provider calls forbidden' });
  ledgers.set(context, { unexpected, errors });
});
const ledgers = new WeakMap<object, { unexpected: string[]; errors: string[] }>();
test.afterEach(async ({ context }, info) => {
  const ledger = ledgers.get(context)!;
  writeFileSync(info.outputPath('traffic.json'), JSON.stringify({ ...ledger, providerCalls: 0 }, null, 2));
  expect(ledger.unexpected).toEqual([]);
  expect(ledger.errors).toEqual([]);
});

test('failed first task: explicit draft use, isolated trial, formal modifications and recovery keep failure history', async ({ context, baseURL }, info) => {
  test.setTimeout(120000);
  let requests = 0;
  await context.route('**/api/generate', route => {
    const round = requests++;
    return round === 0 ? initialFixture(route, 'unreviewed') : fulfillGeneration(route, { json: {
      html: crossAppFixture('reading', true, round === 2), model: 'OFFLINE FIXTURE', durationMs: 1, generatedAt: 'fixture', assistantReply: 'OFFLINE MODIFICATION',
    } });
  });
  const evidence: Record<string, unknown> = {};
  const final = await crossAppWorkflow(context, baseURL!, 'reading', (label, value) => {
    evidence[label] = value; writeFileSync(info.outputPath(`${label}.json`), JSON.stringify(value, null, 2));
  }, { initialDraft: 'use-synthetic' });
  const initial = evidence['initial-disposition'] as ReturnType<typeof initialDisposition>;
  expect(initial).toMatchObject({ kind: 'draft-usable', taskOutcome: 'failed', businessRow: 'absent' });
  expect(evidence.lifecycle).toMatchObject({ path: 'explicit-retained-artifact-continuation', initialTaskOutcome: 'failed' });
  const raw = evidence['initial-storage'] as Snapshot;
  expect(() => initialDisposition(raw, initial.projectId, 'wrong-task')).toThrow('Wrong initial task');
  const tampered = structuredClone(raw);
  projectById(tampered, initial.projectId).previewPolicy!.adoption = 'blocked';
  expect(() => initialDisposition(tampered, initial.projectId, initial.taskId)).toThrow('Draft policy disagrees');
  const stopped = structuredClone(raw);
  projectById(stopped, initial.projectId).initialGeneration!.team!.outcome = 'stopped';
  expect(() => initialDisposition(stopped, initial.projectId, initial.taskId)).toThrow('Ineligible task outcome');
  const changedCode = structuredClone(raw);
  projectById(changedCode, initial.projectId).draftResult!.html += ' ';
  expect(() => initialDisposition(changedCode, initial.projectId, initial.taskId)).toThrow('Invalid retained artifact');
  const project = projectById(final, initial.projectId), team = project.initialGeneration!.team!;
  expect(team.outcome).toBe('failed'); expect(team.review).toBeUndefined();
  expect(team.calls.filter(call => call.actor === 'Reviewer')).toHaveLength(0);
  expect(team.calls.at(-1)).toMatchObject({ actor: 'Mike', status: 'failed' });
  expect(project.modificationRecords![0].generations).toHaveLength(2);
  expect(requests).toBe(3);
  // Selection remains correct with both arrays reordered; missing current state is an error.
  const reordered = { projects: [...final.projects].reverse(), data: [...final.data].reverse() };
  expect(projectById(reordered, initial.projectId)).toEqual(project);
  expect(requireApplicationData(reordered, initial.projectId)).toEqual(requireApplicationData(final, initial.projectId));
  expect(() => requireApplicationData({ ...reordered, data: reordered.data.filter(row => row.projectId !== initial.projectId) }, initial.projectId)).toThrow('Missing committed business state');
  expect(applicationDataFor(final, '00000000-0000-4000-8000-000000000040')!.state).toEqual({ books: [{ id: 'unrelated', name: '无关正式记录' }] });
});

for (const mode of ['unreviewed', 'data-risk', 'execution-blocked', 'no-artifact'] as const) {
  test(`${mode}: default/forbidden first use stops the shared driver without formal writes`, async ({ context, baseURL }, info) => {
    let requests = 0;
    await context.route('**/api/generate', route => { requests++; return initialFixture(route, mode); });
    const evidence: Record<string, unknown> = {};
    const expected = { unreviewed: 'draft-usable', 'data-risk': 'draft-restricted', 'execution-blocked': 'execution-blocked', 'no-artifact': 'no retained artifact' }[mode];
    await expect(crossAppWorkflow(context, baseURL!, 'reading', (label, value) => {
      evidence[label] = value; writeFileSync(info.outputPath(`${label}.json`), JSON.stringify(value, null, 2));
    }, mode === 'unreviewed' ? {} : { initialDraft: 'use-synthetic' })).rejects.toThrow(expected);
    const disposition = evidence['initial-disposition'] as ReturnType<typeof initialDisposition>, stored = evidence['initial-storage'] as Snapshot;
    expect(disposition.kind).toBe(mode === 'no-artifact' ? 'no-artifact' : expected);
    expect(applicationDataFor(stored, disposition.projectId)).toBeUndefined();
    expect(evidence['explicit-first-use']).toBeUndefined();
    const restored = await context.newPage();
    await restored.goto(mode === 'no-artifact' ? baseURL! : `${baseURL}/?project=${disposition.projectId}`);
    if (mode === 'execution-blocked') {
      await expect(restored.getByRole('alert').filter({ hasText: '无条件空循环' })).toBeVisible();
      await expect(restored.locator('iframe')).toHaveCount(0);
    } else if (mode !== 'no-artifact') {
      const use = restored.getByRole('button', { name: '使用此版本', exact: true });
      if (mode === 'data-risk') await expect(use).toBeDisabled(); else await expect(use).toBeEnabled();
      await expect(restored.frameLocator('iframe').locator('[data-atoms-status]')).toHaveText('已读取');
    } else await expect(restored.getByLabel('你想做什么？')).toBeVisible();
    expect((await snapshot(restored)).data).toEqual(stored.data);
    if (mode !== 'no-artifact') expect(projectById(await snapshot(restored), disposition.projectId)).toEqual(projectById(stored, disposition.projectId));
    expect(requests).toBe(1);
    await restored.close();
  });
}

test('live CLI manifests expose the opt-in and current artifact bound without launching a target', () => {
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'tests/team/live-cross-app.ts', ...args], { encoding: 'utf8' }));
  expect(run()).toMatchObject({ initialDraft: 'stop', perTask: { engineerArtifacts: 3 } });
  expect(run('--use-retained-draft')).toMatchObject({ initialDraft: 'use-synthetic', taskCount: 3 });
  expect(() => run('--repair', '--use-retained-draft')).toThrow();
});
