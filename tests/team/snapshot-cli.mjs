// Exercise the documented tsx import path, not Playwright's own TS transformer.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { snapshot } from './cross-app-workflow.ts';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const evidence = process.env.SNAPSHOT_EVIDENCE_DIR;
try {
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await context.tracing.start({ screenshots: true, snapshots: true });
  }
  // Synthetic origin is fulfilled locally. No app, provider, or user profile is used.
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>snapshot regression</title>' }));
  const page = await context.newPage();
  await page.goto('http://snapshot.test/?project=z-active');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const seed = {
    projects: [{ id: 'a-other', title: 'other' }, { id: 'z-active', title: 'active' }],
    data: [{ projectId: 'a-other', state: { n: 1 } }, { projectId: 'z-active', state: { books: [{ id: 'kept', name: '正式保留', extra: { retained: true } }] } }],
  };
  await page.evaluate(async seed => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('atoms-projects', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' });
        request.result.createObjectStore('applicationData', { keyPath: 'projectId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['projects', 'applicationData'], 'readwrite');
        for (const project of seed.projects) tx.objectStore('projects').put(project);
        for (const row of seed.data) tx.objectStore('applicationData').put(row);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, seed);
  const active = await snapshot(page);
  assert.deepEqual(active, { projects: [...seed.projects].reverse(), data: [...seed.data].reverse() });
  await page.reload();
  assert.deepEqual(await snapshot(page), active);
  await page.goto('http://snapshot.test/?project=a-other');
  assert.deepEqual(await snapshot(page), seed);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', entry: 'node --import tsx tests/team/snapshot-cli.mjs', checks: ['actual helper and browser', 'both stores and active project ordering', 'reload preserves snapshot'], providerCalls: 0 }));
} finally {
  try { if (evidence) await context.tracing.stop({ path: `${evidence}/trace.zip` }); }
  finally { await browser.close(); }
}
