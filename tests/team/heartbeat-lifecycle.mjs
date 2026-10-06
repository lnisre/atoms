// Zero-network integration probe. Uses the production client/adapter, native
// ReadableStream and real 4s/10s timers. Only the WebSocket/browser shell is fake.
// Error observers record failures and force exit 1; they do not hide them.
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { readTeam } from '../../src/lib/team/client.ts';

const scenario = process.argv[2];
assert(['abort', 'timeout', 'socket-error', 'ack-rejected', 'normal', 'complete-pending', 'abort-after-ack'].includes(scenario));
const unhandledRejections = [], uncaughtExceptions = [];
process.on('unhandledRejection', reason => { unhandledRejections.push(String(reason)); process.exitCode = 1; });
process.on('uncaughtException', reason => { uncaughtExceptions.push(String(reason)); process.exitCode = 1; });
const native = { setInterval, clearInterval, setTimeout, clearTimeout };
const intervals = new Set(), timeouts = new Set();
// Observe cleanup without replacing time or changing scheduling.
globalThis.setInterval = (fn, ms, ...args) => {
  const handle = native.setInterval(fn, ms, ...args); intervals.add(handle); return handle;
};
globalThis.clearInterval = handle => { intervals.delete(handle); native.clearInterval(handle); };
globalThis.setTimeout = (fn, ms, ...args) => {
  const handle = native.setTimeout(() => { timeouts.delete(handle); fn(...args); }, ms);
  timeouts.add(handle); return handle;
};
globalThis.clearTimeout = handle => { timeouts.delete(handle); native.clearTimeout(handle); };

class Socket extends EventTarget {
  static OPEN = 1; static CLOSING = 2; static CLOSED = 3; static latest;
  readyState = 0; sent = []; closeCalls = 0;
  constructor() { super(); Socket.latest = this; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() {
    this.closeCalls++;
    if (this.readyState >= Socket.CLOSING) return;
    this.readyState = Socket.CLOSING;
    queueMicrotask(() => {
      this.readyState = Socket.CLOSED;
      this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
    });
  }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
globalThis.WebSocket = Socket;
globalThis.location = new URL('http://fixture.invalid');
globalThis.window = new EventTarget();
const abort = new AbortController();
const hash = value => createHash('sha256').update(value).digest('hex');
const started = Date.now();
const response = Response.json({ protocol: 'atoms-team/3', transport: 'websocket', taskId: 'task', ticket: 'offline' });
const reading = readTeam(response, 'task', 'project', abort.signal, () => {}, () => {}).then(
  result => ({ status: 'resolved', result }),
  error => ({ status: 'rejected', name: error.name, message: error.message }),
);
async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'fixture did not reach the required production heartbeat');
    await delay(10);
  }
}
await until(() => Socket.latest);
const ws = Socket.latest;
ws.readyState = Socket.OPEN; ws.dispatchEvent(new Event('open'));
ws.message({ type: 'session', protocol: 'atoms-team/3', taskId: 'task', projectId: 'project', token: 'offline' });
const heartbeats = () => ws.sent.filter(m => m.action === 'heartbeat');
await until(() => heartbeats().length === 1);
assert.equal(timeouts.size, 1, 'the actual control request must be pending');
assert.equal(intervals.size, 1, 'the actual heartbeat interval must be active');

function finishNormally() {
  // Same valid synthetic protocol as tests/browser/team-fixture.ts; no model.
  const html = '<!DOCTYPE html><html><head></head><body>offline</body></html>', codeHash = hash(html);
  const review = { kind: 'code-review', schemaVersion: 1, resolutions: [], taskId: 'task', codeHash, approved: true, summary: 'synthetic', issues: [] };
  const delivery = (role, value) => ({ role, content: JSON.stringify(value) });
  const assign = to => delivery('Mike', { command: 'assign', to, reason: 'synthetic', instruction: 'synthetic' });
  const deliveries = [assign('Requirements'), delivery('Requirements', { requirements: [{ id: 'synthetic', description: 'synthetic' }] }), assign('Engineer'), delivery('Engineer', { codeHash, iteration: 1 }), assign('Reviewer'), delivery('Reviewer', review), delivery('Mike', { command: 'finish' })];
  const team = { protocol: 'atoms-team/3', taskId: 'task', projectId: 'project', codeHash, review, outcome: 'passed', deliveries, calls: deliveries.map((d, i) => ({ call: i + 1, actor: d.role, requestedModel: 'fixture', status: 'completed' })) };
  ws.message({ type: 'result', protocol: 'atoms-team/3', taskId: 'task', team, result: { html, model: 'fixture', durationMs: 1, generatedAt: 'synthetic' }, assistantReply: null });
  ws.readyState = Socket.CLOSED;
  ws.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
}
const ack = () => ws.message({ type: 'control-ack', id: heartbeats().at(-1).id, ok: true });
if (scenario === 'abort') abort.abort();
if (scenario === 'socket-error') ws.message({ type: 'socket-error', error: 'controlled transport failure' });
if (scenario === 'ack-rejected') ws.message({ type: 'control-ack', id: heartbeats()[0].id, ok: false, error: 'heartbeat refused' });
if (scenario === 'normal' || scenario === 'abort-after-ack') {
  ack();
  await delay(0);
  assert.equal(timeouts.size, 0);
  if (scenario === 'abort-after-ack') abort.abort();
  else {
    await until(() => heartbeats().length === 2);
    ack(); finishNormally();
  }
}
if (scenario === 'complete-pending') finishNormally();
// timeout uses the unchanged real 10-second adapter timer; further 4-second
// heartbeats overlap, so termination must also reject and clean those controls.
const outcome = await reading;
const sentAtEnd = ws.sent.length;
ws.message({ type: 'control-ack', id: 1, ok: true });
ws.message({ type: 'result', taskId: 'late' });
ws.dispatchEvent(new Event('error'));
ws.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
abort.abort();
await delay(50); // Let Node report unhandled rejections from all cleanup jobs.
const cleanup = {
  intervals: intervals.size, timeouts: timeouts.size,
  abortListeners: getEventListeners(abort.signal, 'abort').length,
  pagehideListeners: getEventListeners(window, 'pagehide').length,
  socketListeners: ['open', 'message', 'error', 'close'].reduce((sum, type) => sum + getEventListeners(ws, type).length, 0),
  sentAfterEnd: ws.sent.length - sentAtEnd,
};
const evidence = { scenario, node: process.version, elapsedMs: Date.now() - started, identity: Object.fromEntries(['src/lib/team/client.ts', 'src/lib/team/socket.ts'].map(path => [path, hash(readFileSync(path))])), heartbeatCount: heartbeats().length, outcome, cleanup, unhandledRejections, uncaughtExceptions, providerCalls: 0 };
console.log(JSON.stringify(evidence, null, 2));
assert.deepEqual(unhandledRejections, [], 'cleanup emitted an unhandled Promise rejection');
assert.deepEqual(uncaughtExceptions, [], 'cleanup emitted an uncaught exception');
assert(Object.values(cleanup).every(value => value === 0), 'task resources must be released');
if (scenario === 'normal' || scenario === 'complete-pending') {
  assert.equal(outcome.status, 'resolved'); assert.equal(outcome.result.team.outcome, 'passed');
} else {
  assert.equal(outcome.status, 'rejected');
  if (scenario.startsWith('abort')) assert.equal(outcome.name, 'AbortError');
  if (scenario === 'timeout') assert.match(outcome.message, /工具回传超时/);
  if (scenario === 'socket-error') assert.match(outcome.message, /controlled transport failure/);
  if (scenario === 'ack-rejected') assert.match(outcome.message, /团队连接中断/);
}
