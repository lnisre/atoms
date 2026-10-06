// Adapt the pinned bidirectional connection to the existing bounded event reader.
// No reconnect: reconnecting would be a new task, not budget-preserving recovery.
export async function openTeamSocket(ticket: unknown, signal: AbortSignal) {
  const url = new URL('/api/team/socket', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  let ended = false, sequence = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
    // The stream is already closed by the consumer before this hook runs.
    cancel() { finish('cancel', new Error('团队连接已取消')); },
  });

  function finish(kind: 'cancel' | 'close' | 'error', reason: Error) {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', onAbort);
    ws.removeEventListener('open', onOpen);
    ws.removeEventListener('message', onMessage);
    ws.removeEventListener('error', onError);
    ws.removeEventListener('close', onClose);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    if (kind === 'error') streamController.error(reason);
    else if (kind === 'close') streamController.close();
    if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) ws.close(1000);
  }
  const fail = (error: unknown) => finish('error', error instanceof Error ? error : new Error(String(error)));
  const close = () => finish('close', new Error('团队连接已结束'));
  function onAbort() { fail(signal.reason ?? new DOMException('任务已停止', 'AbortError')); }
  function onOpen() {
    if (ended) return;
    if (signal.aborted) { onAbort(); return; }
    try { ws.send(JSON.stringify({ action: 'start', ticket })); }
    catch (error) { fail(error); }
  }
  function onMessage(event: MessageEvent) {
    if (ended) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'socket-error') { fail(message.error); return; }
      if (message.type === 'control-ack') {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.ok) request.resolve();
        else request.reject(new Error(message.error || '工具回传被拒绝'));
      } else streamController.enqueue(new TextEncoder().encode(event.data + '\n'));
    } catch { fail(new Error('团队连接协议错误')); }
  }
  function onError() { fail(new Error('无法连接四角色执行器。')); }
  function onClose(event: CloseEvent) {
    if (ended) return;
    if (event.code !== 1000) fail(new Error('团队连接中断，未恢复后台执行。'));
    else close();
  }
  signal.addEventListener('abort', onAbort, { once: true });
  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', onMessage);
  ws.addEventListener('error', onError);
  ws.addEventListener('close', onClose);
  if (signal.aborted) onAbort();

  const control = (body: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    if (ended || ws.readyState !== WebSocket.OPEN) { reject(new Error('团队连接不可用')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => fail(new Error('工具回传超时')), 10000);
    pending.set(id, { resolve, reject, timer });
    try { ws.send(JSON.stringify({ ...body, id })); }
    catch (error) { fail(error); }
  });
  return { response: new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }), control, close };
}
