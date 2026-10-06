import assert from 'node:assert/strict';
import type { SavedProject } from '../../src/lib/project-store';
import { previewPolicy } from '../../src/lib/team/preview-policy';
import { artifactTeam } from '../../src/lib/team/review';
import { hash } from './independent-check';

export type Snapshot = {
  projects: SavedProject[];
  // Workspace metadata shares this store and deliberately has no state.
  data: { projectId: string; state?: Record<string, unknown> }[];
};
export function projectById(snapshot: Snapshot, projectId: string) {
  const matches = snapshot.projects.filter(project => project.id === projectId);
  assert.equal(matches.length, 1, `Expected exactly one saved project: ${projectId}`);
  return matches[0];
}
export function applicationDataFor(snapshot: Snapshot, projectId: string) {
  const matches = snapshot.data.filter(row => row.projectId === projectId);
  assert(matches.length <= 1, `Duplicate business rows: ${projectId}`);
  return matches[0];
}
export function requireApplicationData(snapshot: Snapshot, projectId: string) {
  const row = applicationDataFor(snapshot, projectId);
  assert(row?.state && typeof row.state === 'object' && !Array.isArray(row.state), `Missing committed business state for ${projectId}`);
  return row.state;
}

// Read raw persisted fields; never infer permission from a UI save label or row order.
// This observes the first generated artifact, before candidate adoption changes its code.
export function initialDisposition(snapshot: Snapshot, projectId: string, taskId: string) {
  if (!snapshot.projects.some(project => project.id === projectId)) {
    assert.equal(applicationDataFor(snapshot, projectId), undefined, 'Unsaved project has business data');
    return { kind: 'no-artifact' as const, projectId, taskId };
  }
  const project = projectById(snapshot, projectId), team = project.initialGeneration?.team;
  assert.equal(project.initialGeneration?.taskId, taskId, 'Wrong initial task');
  assert(team && team.taskId === taskId && team.projectId === projectId, 'Wrong artifact identity');
  assert(['passed', 'issues', 'failed', 'limit'].includes(team.outcome ?? ''), 'Ineligible task outcome');
  const result = project.draftResult ?? project.result, codeHash = hash(result.html);
  assert(artifactTeam(team, codeHash, true), 'Invalid retained artifact');
  const computed = previewPolicy(team, result.html), persisted = project.previewPolicy;
  assert(persisted, 'Missing persisted preview policy');
  if (project.draftResult) {
    assert.deepEqual(persisted, computed, 'Draft policy disagrees with current code/team');
    assert(computed.dataMode === 'trial' || computed.status === 'blocked', 'Unexpected draft');
    assert.notEqual(project.result.html, result.html, 'Draft leaked into legacy result');
    assert(!/<script\b/i.test(project.result.html), 'Legacy result must be inert');
  } else {
    // Explicit first use keeps review/outcome unchanged but switches persisted dataMode.
    assert.equal(computed.status, 'allowed');
    assert.equal(computed.adoption, 'allowed');
    assert.deepEqual(persisted, { ...computed, dataMode: 'formal' }, 'Formal project lacks permission');
  }
  return {
    kind: !project.draftResult ? 'formal' as const : computed.status === 'blocked' ? 'execution-blocked' as const
      : computed.adoption === 'blocked' ? 'draft-restricted' as const : 'draft-usable' as const,
    projectId, taskId, taskOutcome: team.outcome, codeHash, policy: persisted,
    businessRow: applicationDataFor(snapshot, projectId) ? 'present' : 'absent',
  };
}

export function expectInitialHistoryPreserved(before: SavedProject, after: SavedProject) {
  assert(before.initialGeneration && after.initialGeneration, 'Missing initial history');
  const { events: previous, ...original } = before.initialGeneration;
  const { events: current, ...retained } = after.initialGeneration;
  assert.deepEqual(retained, original, 'Initial task outcome, calls, deliveries or reply changed');
  for (const event of previous) {
    assert.deepEqual(current.find(item => item.source === event.source && item.sequence === event.sequence), event, 'Initial execution event changed or disappeared');
  }
}
