// Synthetic isolated-service diagnostic. No application keys, users or model calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

export function startProbe({ origin, version = 'v1', port = 8080, host = '0.0.0.0', log = console.log }) {
  const url = new URL(origin);
  if (url.origin !== origin || !(url.protocol === 'https:'
    || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw Error('Requires exact HTTPS public origin or loopback HTTP origin');
  }
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(version)) throw Error('Invalid probe version');
  const cookiePresent = request => ['atoms_probe_a=synthetic-a', 'atoms_probe_b=synthetic-b']
    .every(value => (request.headers.cookie ?? '').split(';').map(item => item.trim()).includes(value));
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, origin).pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/health' || path === '/probe/cookies') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ synthetic: true, version, cookiesPresent: cookiePresent(request) }));
    } else if (path === '/' || path === '/probe') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Set-Cookie', ['atoms_probe_a=synthetic-a', 'atoms_probe_b=synthetic-b']
        .map(cookie => `${cookie}; HttpOnly; SameSite=Lax; Path=/${secure}`));
      response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>Atoms synthetic hosting probe</title><h1>Atoms 合成入口探针</h1><p>仅用于隔离服务，不进行真实登录或模型调用。运行两次正常心跳、一次业务静默心跳及一次完全空闲连接，各观察 600 秒。结果不会放行产品迁移。</p><button id="run">开始 600 秒测试</button><pre id="result"></pre><script type="module" src="/probe/client.mjs"></script></html>');
    } else if (path === '/probe/client.mjs') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(await readFile(new URL('./client.mjs', import.meta.url)));
    } else {
      response.writeHead(404).end();
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024,
    handleProtocols: protocols => protocols.has('atoms-hosting-probe.v1') ? 'atoms-hosting-probe.v1' : false });
  server.on('upgrade', (request, socket, head) => {
    let address;
    try { address = new URL(request.url, origin); } catch { socket.destroy(); return; }
    const mode = address.searchParams.get('mode');
    if (address.pathname !== '/probe/socket' || !['normal', 'heartbeat', 'idle'].includes(mode)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
    }
    if (request.headers.origin !== origin || !cookiePresent(request)
      || request.headers['sec-websocket-protocol'] !== 'atoms-hosting-probe.v1') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    if (sockets.clients.size >= 8) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      const connection = randomUUID(), opened = performance.now();
      log(JSON.stringify({ event: 'open', connection, mode, version }));
      ws.send(JSON.stringify({ type: 'ready', synthetic: true, version, connection }));
      ws.on('message', bytes => {
        let message;
        try { message = JSON.parse(bytes.toString()); } catch { ws.close(1008, 'invalid-message'); return; }
        if (mode === 'idle') { ws.close(1008, 'idle-mode-message'); return; }
        if (message.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
        else if (mode === 'normal' && message.type === 'echo') ws.send(JSON.stringify({ type: 'echo', value: 'synthetic' }));
        else ws.close(1008, 'invalid-message');
      });
      const deadline = setTimeout(() => ws.close(1000, 'probe-limit'), 630_000);
      ws.on('close', code => {
        clearTimeout(deadline);
        log(JSON.stringify({ event: 'close', connection, mode, version,
          durationMs: Math.round(performance.now() - opened), code }));
      });
    });
  });
  // The probe intentionally exposes interruption; it does not promise draining.
  const stop = () => {
    for (const socket of sockets.clients) socket.close(1012, 'probe-instance-exit');
    server.close();
    setTimeout(() => { for (const socket of sockets.clients) socket.terminate(); }, 1000).unref();
  };
  server.listen(port, host);
  return { server, sockets, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const probe = startProbe({ origin: process.env.ATOMS_PROBE_ORIGIN,
    version: process.env.ATOMS_PROBE_VERSION ?? 'v1', port: Number(process.env.PORT ?? 8080) });
  process.once('SIGTERM', probe.stop);
  process.once('SIGINT', probe.stop);
}
