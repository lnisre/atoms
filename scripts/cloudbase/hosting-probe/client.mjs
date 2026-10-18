// Native browser WebSocket and same-origin synthetic cookies; no reconnect/replay.
export async function runHostingProbe({ durationMs = 600_000, update = () => {} } = {}) {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 600_000) throw Error('Invalid observation duration');
  const startedAt = new Date().toISOString();
  const cookies = await fetch('/probe/cookies', { credentials: 'same-origin' }).then(response => response.json());
  if (!cookies.synthetic || !cookies.cookiesPresent) throw Error('Synthetic cookie round-trip failed');
  const run = (name, mode) => new Promise(resolve => {
    const address = new URL('/probe/socket', location.href);
    address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    address.searchParams.set('mode', mode);
    const socket = new WebSocket(address, 'atoms-hosting-probe.v1');
    const result = { name, mode, version: null, opened: false, durationMs: 0,
      heartbeatAcks: 0, echoes: 0, code: null, error: false, observationCompleted: false };
    let openedAt, heartbeat, business, deadline, closeDeadline, settled = false;
    let lastAck, lastEcho, ready = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      for (const timer of [connectDeadline, hardDeadline, heartbeat, business, deadline, closeDeadline]) clearInterval(timer);
      result.durationMs = openedAt === undefined ? 0 : Math.round(performance.now() - openedAt);
      result.code = code;
      result.lastAckAgeMs = lastAck === undefined ? null : Math.round(performance.now() - lastAck);
      result.lastEchoAgeMs = lastEcho === undefined ? null : Math.round(performance.now() - lastEcho);
      const continuousHeartbeat = result.heartbeatAcks >= Math.max(1, Math.floor(durationMs / 5000) - 2)
        && result.lastAckAgeMs !== null && result.lastAckAgeMs <= 15_000;
      const continuousEcho = result.echoes >= Math.max(1, Math.floor(durationMs / 20_000) - 2)
        && result.lastEchoAgeMs !== null && result.lastEchoAgeMs <= 30_000;
      const completed = result.opened && ready && result.observationCompleted && code === 1000
        && result.durationMs >= durationMs && !result.error;
      // Complete idle is an observation of platform policy, not the active-task release gate.
      result.status = mode === 'idle' ? 'observed' : completed && continuousHeartbeat
        && (mode !== 'normal' || continuousEcho) ? 'passed' : 'failed';
      update({ event: 'close', ...result }); resolve(result);
    };
    const close = (code = 1000, reason = 'probe-ended') => {
      if (settled) return;
      clearInterval(heartbeat); clearInterval(business);
      clearTimeout(closeDeadline);
      try { socket.close(code, reason); } catch { result.error = true; }
      closeDeadline = setTimeout(() => { result.error = true; finish(null); }, 2500);
    };
    const connectDeadline = setTimeout(() => { result.error = true; close(); }, 30_000);
    const hardDeadline = setTimeout(() => { result.error = true; close(); finish(null); }, durationMs + 45_000);
    socket.addEventListener('open', () => {
      clearTimeout(connectDeadline);
      result.opened = true; openedAt = performance.now();
      if (mode !== 'idle') {
        socket.send(JSON.stringify({ type: 'heartbeat' }));
        heartbeat = setInterval(() => socket.send(JSON.stringify({ type: 'heartbeat' })), 5000);
      }
      if (mode === 'normal') {
        socket.send(JSON.stringify({ type: 'echo' }));
        business = setInterval(() => socket.send(JSON.stringify({ type: 'echo' })), 20_000);
      }
      deadline = setTimeout(() => {
        result.observationCompleted = true; close(1000, 'observation-complete');
      }, durationMs);
      update({ event: 'open', name });
    });
    socket.addEventListener('message', event => {
      if (settled) return;
      let message;
      try { message = JSON.parse(event.data); } catch { result.error = true; close(1008); return; }
      if (message.type === 'ready') {
        if (ready || message.synthetic !== true || socket.protocol !== 'atoms-hosting-probe.v1'
          || !/^[a-zA-Z0-9._-]{1,40}$/.test(message.version)
          || !/^[a-f0-9-]{36}$/.test(message.connection)) {
          result.error = true; close(1008); return;
        }
        ready = true; result.version = message.version; result.connection = message.connection;
      } else if (ready && message.type === 'heartbeat-ack') {
        result.heartbeatAcks++; lastAck = performance.now();
      } else if (ready && message.type === 'echo' && message.value === 'synthetic') {
        result.echoes++; lastEcho = performance.now();
      } else {
        result.error = true; close(1008);
      }
    });
    socket.addEventListener('error', () => { if (!settled) result.error = true; });
    socket.addEventListener('close', event => {
      finish(event.code);
    });
  });
  const connections = await Promise.all([run('normal-1', 'normal'), run('normal-2', 'normal'),
    run('business-silent', 'heartbeat'), run('fully-idle', 'idle')]);
  return { synthetic: true, origin: location.origin, startedAt,
    requestedDurationMs: durationMs, cookiesPresent: true, connections,
    active600SecondGate: durationMs < 600_000 ? 'unverified-short-local-check'
      : connections.filter(connection => connection.mode !== 'idle')
        .every(connection => connection.status === 'passed') ? 'passed' : 'failed' };
}

const button = document.querySelector('#run'), output = document.querySelector('#result');
button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = 'Running; leave this page open for 600 seconds.\n';
  try {
    window.__atomsHostingProbe = await runHostingProbe({ update: result => {
      output.textContent += JSON.stringify(result) + '\n';
    } });
    output.textContent += JSON.stringify(window.__atomsHostingProbe, null, 2);
  } catch { output.textContent += 'Probe failed before completing; inspect redacted service logs.'; }
  finally { button.disabled = false; }
});
