import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

test('snapshot survives the actual node --import tsx browser entry', async ({}, info) => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'tests/team/snapshot-cli.mjs'],
    { env: { ...process.env, SNAPSHOT_EVIDENCE_DIR: info.outputPath('cli') }, timeout: 25_000 });
  await info.attach('cli-output', { body: stdout + stderr, contentType: 'text/plain' });
  expect(JSON.parse(stdout)).toMatchObject({ status: 'passed', providerCalls: 0 });
});
