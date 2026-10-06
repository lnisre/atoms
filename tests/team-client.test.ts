import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

// Isolated processes make unhandled rejections observable without adding a
// process-wide suppression listener to the Node test runner.
for (const scenario of ['abort', 'timeout', 'socket-error', 'ack-rejected', 'normal', 'complete-pending', 'abort-after-ack']) {
  test(`readTeam heartbeat lifecycle: ${scenario}`, { timeout: 25000 }, async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tests/team/heartbeat-lifecycle.mjs', scenario], { timeout: 20000 });
    const evidence = JSON.parse(stdout);
    if (process.env.TEAM_CLIENT_EVIDENCE_DIR) {
      mkdirSync(process.env.TEAM_CLIENT_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.TEAM_CLIENT_EVIDENCE_DIR, `${scenario}.json`), stdout);
    }
    assert.deepEqual(evidence.unhandledRejections, []);
    assert.deepEqual(evidence.uncaughtExceptions, []);
    assert(Object.values(evidence.cleanup).every(value => value === 0));
  });
}
