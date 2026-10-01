import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { Scenario, ToolRequest, ToolResult } from '../../src/lib/qa/contract';
const load = createRequire(resolve('package.json'));
const esbuild = createRequire(load.resolve('tsx'))('esbuild');
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let bundle: Promise<string> | undefined;
export async function independentCheck(page: Page, html: string, scenarios: Scenario[]) {
  bundle ??= esbuild.build({ entryPoints: ['src/lib/qa/browser-tool.ts'], bundle: true, format: 'iife', globalName: 'IndependentAcceptance', platform: 'browser', write: false }).then((r: { outputFiles: { text: string }[] }) => r.outputFiles[0].text);
  await page.addScriptTag({ content: await bundle! });
  const request: ToolRequest = { protocol: 'atoms-qa/1', taskId: randomUUID(), requestId: randomUUID(), html,
    codeHash: hash(html), planHash: hash(JSON.stringify(scenarios)), deadline: Date.now() + 30_000, scenarios };
  const encoded = await page.evaluate(async encoded => {
    const request: ToolRequest = JSON.parse(encoded);
    const host = document.createElement('div'); document.body.append(host);
    const tool = (window as typeof window & { IndependentAcceptance: { runBrowserCheck: (r: ToolRequest, h: HTMLElement, s: AbortSignal, p: () => void) => Promise<ToolResult> } }).IndependentAcceptance;
    try { return JSON.stringify(await tool.runBrowserCheck(request, host, new AbortController().signal, () => {})); }
    finally { host.remove(); }
  }, JSON.stringify(request));
  const result: ToolResult = JSON.parse(encoded);
  return { kind: 'independent developer browser acceptance; not Reviewer execution', request, result };
}
