import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test, type TestContext } from "node:test";
import { openTeamSocket } from "../src/lib/team/socket";

// No network/provider: drive the actual adapter and native ReadableStream.
class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static latest: Socket;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closeCalls = 0;
  listeners = new Map<string, Set<(event: never) => void>>();
  constructor() { Socket.latest = this; }
  addEventListener(type: string, fn: (event: never) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: never) => void) { this.listeners.get(type)?.delete(fn); }
  emit(type: string, event: unknown = {}) {
    for (const fn of [...this.listeners.get(type) ?? []]) fn(event as never);
  }
  open() { this.readyState = Socket.OPEN; this.emit("open"); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closeCalls++; this.readyState = Socket.CLOSING; }
}

async function setup(t: TestContext, aborted = false) {
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const oldSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://synthetic.invalid/") });
  t.after(() => {
    globalThis.WebSocket = oldSocket;
    if (oldLocation) Object.defineProperty(globalThis, "location", oldLocation);
    else Reflect.deleteProperty(globalThis, "location");
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const abort = new AbortController();
  if (aborted) abort.abort();
  const owned = await openTeamSocket({ synthetic: true }, abort.signal);
  const socket = Socket.latest;
  const reader = owned.response.body!.getReader();
  t.after(() => owned.close());
  return { ...owned, socket, reader, abort };
}

test("reader cancellation followed by normal socket close never closes the stream twice", async t => {
  const { socket, reader } = await setup(t);
  socket.open();
  await reader.cancel();
  assert.doesNotThrow(() => socket.emit("close", { code: 1000 }));
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  assert.equal(socket.closeCalls, 1);
});

test("normal events drain in order; control success/rejection stays out of the stream", async t => {
  const { socket, reader, control, abort } = await setup(t);
  socket.open();
  assert.deepEqual(socket.sent[0], { action: "start", ticket: { synthetic: true } });
  const accepted = control({ action: "heartbeat" });
  const rejected = assert.rejects(control({ action: "feedback" }), /refused/);
  socket.message({ type: "control-ack", id: 1, ok: true });
  socket.message({ type: "control-ack", id: 2, ok: false, error: "refused" });
  socket.message({ type: "control-ack", id: 2, ok: true });
  socket.message({ type: "step", sequence: 1 });
  socket.message({ type: "result", sequence: 2 });
  socket.readyState = Socket.CLOSED;
  socket.emit("close", { code: 1000 });
  await accepted; await rejected;
  const decoder = new TextDecoder();
  assert.equal(decoder.decode((await reader.read()).value), '{"type":"step","sequence":1}\n');
  assert.equal(decoder.decode((await reader.read()).value), '{"type":"result","sequence":2}\n');
  assert.equal((await reader.read()).done, true);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  t.mock.timers.tick(10001);
  assert.equal(socket.closeCalls, 0);
});

for (const end of ["cancel", "abort", "close", "normal-close", "abnormal-close", "error", "protocol", "socket-error", "timeout", "send-error"] as const) {
  test(`${end} settles all pending controls and ignores late events without waiting for a close callback`, async t => {
    const { socket, reader, control, abort, close } = await setup(t);
    socket.open();
    const late = Object.fromEntries([...socket.listeners].map(([type, listeners]) => [type, [...listeners]]));
    const clearTimer = t.mock.method(globalThis, "clearTimeout");
    const reason = {
      cancel: /已取消/, abort: /abort/i, close: /已结束/, 'normal-close': /已结束/,
      'abnormal-close': /中断，未恢复/, error: /无法连接/, protocol: /协议错误/,
      'socket-error': /fixture failure/, timeout: /回传超时/, 'send-error': /send failed/,
    }[end];
    const first = assert.rejects(control({ action: "heartbeat" }), reason);
    const second = assert.rejects(control({ action: "feedback" }), reason);
    const failed = ["abort", "abnormal-close", "error", "protocol", "socket-error", "timeout", "send-error"].includes(end);
    const reading = failed ? assert.rejects(reader.read(), reason) : reader.read();
    if (end === "cancel") await reader.cancel();
    if (end === "abort") abort.abort();
    if (end === "close") close();
    if (end === "normal-close" || end === "abnormal-close") {
      socket.readyState = Socket.CLOSED;
      socket.emit("close", { code: end === "normal-close" ? 1000 : 1006 });
    }
    if (end === "error") socket.emit("error");
    if (end === "protocol") socket.emit("message", { data: "{" });
    if (end === "socket-error") socket.message({ type: "socket-error", error: "fixture failure" });
    if (end === "timeout") t.mock.timers.tick(10000);
    if (end === "send-error") {
      t.mock.method(socket, "send", () => { throw new Error("send failed"); });
      await assert.rejects(control({ action: "feedback" }), /send failed/);
    }
    await Promise.all([first, second, reading]);
    assert.equal(clearTimer.mock.callCount(), end === "send-error" ? 3 : 2);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
    assert.equal([...socket.listeners.values()].flatMap(v => [...v]).length, 0);
    const sent = socket.sent.length, closes = socket.closeCalls;
    // Invoke even captured callbacks: removal alone must not be the state guard.
    for (const [type, event] of [["open", {}], ["message", { data: '{"type":"result"}' }], ["message", { data: '{"type":"control-ack","id":1,"ok":true}' }], ["message", { data: "{" }], ["error", {}], ["close", { code: 1000 }], ["close", { code: 1006 }]] as const) {
      for (const fn of late[type]) assert.doesNotThrow(() => fn(event as never));
    }
    abort.abort(); close();
    await reader.cancel().catch(() => {});
    // Socket can still appear OPEN while its close handshake is pending.
    socket.readyState = Socket.OPEN;
    await assert.rejects(control({ action: "heartbeat" }), /不可用/);
    t.mock.timers.tick(20000);
    assert.equal(socket.sent.length, sent);
    assert.equal(socket.closeCalls, closes);
  });
}

test("an already aborted signal never starts a task or retains listeners", async t => {
  const { socket, reader, abort, control } = await setup(t, true);
  await assert.rejects(reader.read(), { name: "AbortError" });
  socket.open();
  assert.equal(socket.sent.length, 0);
  assert.equal(socket.closeCalls, 1);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  await assert.rejects(control({ action: "heartbeat" }));
});

test("abort while connecting prevents start even if open arrives later", async t => {
  const { socket, reader, abort } = await setup(t);
  abort.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
  socket.open();
  assert.equal(socket.sent.length, 0);
});

test("start send failure errors the reader and cleans up the connection", async t => {
  const { socket, reader, abort } = await setup(t);
  t.mock.method(socket, "send", () => { throw new Error("start failed"); });
  const failed = assert.rejects(reader.read(), /start failed/);
  assert.doesNotThrow(() => socket.open());
  await failed;
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  assert.equal(socket.closeCalls, 1);
});
