// Copied beside a local project's runtime settings; contains no experiment labels.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'settings.json')));
const command = process.argv[2];
const evidence = join(cfg.evidence, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid);
mkdirSync(evidence, { recursive: true });
const configRoot = join(here, 'config');
mkdirSync(join(configRoot, 'config'), { recursive: true });
copyFileSync(join(cfg.candidate, 'runtime/team/config2.yaml'), join(configRoot, 'config/config2.yaml'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const wrapper = join(here, 'offline-python');
writeFileSync(wrapper, `#!/bin/sh\nexport HOME=${quote(cfg.home)}\nexport METAGPT_PROJECT_ROOT=${quote(configRoot)}\nexec ${quote(cfg.python)} ${quote(join(cfg.candidate, 'tests/team/fixture_transport.py'))} "$@"\n`, { mode: 0o700 });
// Deliberate allowlist: never forward the host's provider credentials/config.
const env = { PATH: `${dirname(cfg.node)}:${dirname(cfg.pnpm)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: cfg.home, TMPDIR: cfg.profile, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LANG: 'en_US.UTF-8',
  UV_NO_CONFIG: '1', NPM_CONFIG_USERCONFIG: '/dev/null', NEXT_TELEMETRY_DISABLED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
  METAGPT_PROJECT_ROOT: configRoot, ATOMS_TEAM_HOME: cfg.home, ATOMS_TEAM_PYTHON: wrapper,
  DEEPSEEK_API_KEY: 'offline-test-placeholder', QA_TOOL_SIGNING_KEY: 'atoms-offline-test-signing-key' };
process.env = { ...env };
const sha = value => createHash('sha256').update(value).digest('hex');
const fileSha = path => sha(readFileSync(path));
const json = (name, value) => writeFileSync(join(evidence, name + '.json'), JSON.stringify(value, null, 2) + '\n');
function execute(name, executable, args, extra = {}, timeout = 180000) {
  const result = spawnSync(executable, args, { cwd: cfg.candidate, env: { ...env, ...extra }, encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(join(evidence, name + '.stdout.log'), result.stdout || '');
  writeFileSync(join(evidence, name + '.stderr.log'), result.stderr || '');
  json(name + '-execution', { executable, args, exitCode: result.status, signal: result.signal, error: result.error?.message });
  assert(result.status === 0 && !result.error, `${name} failed: see ${evidence}`);
  return result.stdout;
}
const doctorModule = await import(pathToFileURL(join(cfg.candidate, '.agents/skills/verify-atoms/scripts/doctor.mjs')));
const source = () => {
  const git = args => execFileSync('git', args, { cwd: cfg.candidate, encoding: 'utf8' });
  const paths = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(path =>
    /^(src|public|runtime\/team)\//.test(path) ||
    /^[^/]+\.(?:[cm]?[jt]sx?|json|css|ya?ml)$/.test(path)
  ))].sort();
  return { commit: git(['rev-parse', 'HEAD']).trim(), status: git(['status', '--porcelain']),
    files: Object.fromEntries(paths.map(path => [path, existsSync(join(cfg.candidate, path)) ? fileSha(join(cfg.candidate, path)) : null])) };
};
function fixedEntrypoints() {
  for (const [path, expected] of Object.entries(cfg.fixedFiles)) assert.equal(fileSha(join(cfg.candidate, path)), expected, 'Fixed verification/config input changed: ' + path);
}
function configuration() {
  return { settings: fileSha(join(here, 'settings.json')), runtime: fileSha(fileURLToPath(import.meta.url)), wrapper: fileSha(wrapper), config: fileSha(join(configRoot, 'config/config2.yaml')) };
}
function prepared() {
  fixedEntrypoints();
  assert.deepEqual(JSON.parse(readFileSync(join(here, 'prepared.json'))).configuration, configuration(), 'Runtime configuration changed; run prepare again');
}
function processTools() {
  execute('process-ps', 'ps', ['-p', String(process.pid), '-o', 'pid=,ppid=,command=']);
  execute('process-cwd', 'lsof', ['-a', '-p', String(process.pid), '-d', 'cwd', '-Fn']);
}
function processIdentity(pid) {
  const get = args => execFileSync('ps', ['-p', String(pid), '-o', args], { encoding: 'utf8' }).trim();
  const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n').find(line => line.startsWith('n'))?.slice(1);
  assert(cwd === cfg.candidate || cwd?.startsWith(cfg.candidate + '/'), 'Process cwd is outside this candidate');
  return { pid, cwd, command: get('command='), started: get('lstart=') };
}

const stateFile = join(here, 'state.json');
const state = () => JSON.parse(readFileSync(stateFile));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function stoppedBefore(action) {
  if (!existsSync(stateFile)) return;
  const saved = state();
  const live = [saved.pid, ...(saved.internalPids || [])].filter(alive);
  assert.equal(live.length, 0, `Stop the recorded runtime before ${action}; live PIDs: ${live.join(', ')}`);
}
function unchanged() {
  prepared();
  const built = JSON.parse(readFileSync(join(here, 'build-source.json')));
  assert.equal(readFileSync(join(cfg.candidate, '.next/BUILD_ID'), 'utf8').trim(), built.buildId, 'Build ID changed; rebuild');
  assert.deepEqual(source().files, built.source.files, 'Source changed since build; stop, build, start again');
}
async function doctor() {
  unchanged();
  const s = state();
  const result = await doctorModule.doctor({ url: s.url, pid: s.pid, mode: 'team' });
  result.runtime = { configuration: configuration(), provider: 'tests/team/fixture_transport.py', python: cfg.python, home: cfg.home };
  json('doctor', result);
  return result;
}
async function freePair() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const servers = [];
    try {
      for (const p of [port, port + 1]) {
        const server = net.createServer(); servers.push(server);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '0.0.0.0', resolve); });
      }
      return port;
    } catch {} finally { await Promise.all(servers.map(s => new Promise(resolve => s.close(resolve)))); }
  }
  throw new Error('No available port pair');
}
async function stop() {
  if (!existsSync(stateFile)) return { stopped: true, reason: 'never started' };
  const s = state(), ids = [s.pid, ...(s.internalPids || [])];
  const owned = () => {
    for (const pid of ids.filter(alive)) {
      assert(s.processes?.[pid], 'Missing recorded process identity; refusing signal');
      assert.deepEqual(processIdentity(pid), s.processes[pid], 'Recorded PID identity changed; refusing signal');
    }
    for (const port of [s.port, s.port + 1]) assert(doctorModule.listeners(port).every(pid => ids.includes(pid)), 'Recorded port belongs to another process; refusing signal');
  };
  owned();
  if (alive(s.pid)) process.kill(s.pid, 'SIGTERM');
  else for (const pid of (s.internalPids || []).filter(alive)) process.kill(pid, 'SIGTERM');
  for (let n = 0; n < 100 && ids.some(alive); n++) await wait(100);
  owned();
  for (const pid of ids.filter(alive)) process.kill(pid, 'SIGKILL');
  for (let n = 0; n < 50 && ids.some(alive); n++) await wait(100);
  const remaining = ids.filter(alive), listeners = [s.port, s.port + 1].flatMap(p => doctorModule.listeners(p));
  assert.equal(remaining.length + listeners.length, 0, 'Owned process/listener still live');
  const result = { stopped: true, pids: ids, ports: [s.port, s.port + 1], remaining, listeners };
  json('stop', result); return result;
}

try {
  let result;
  const invocation = { command, candidate: cfg.candidate, configuration: configuration(), fixedFiles: cfg.fixedFiles, provider: 'scripted fixture_transport.py', home: cfg.home, python: cfg.python };
  try { invocation.source = source(); } catch (error) {
    if (command !== 'stop') throw error;
    invocation.sourceUnavailable = error.message;
  }
  json('invocation', invocation);
  if (command === 'prepare') {
    fixedEntrypoints();
    assert(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), 'Installed Google Chrome is required');
    processTools();
    assert.match(execute('node', cfg.node, ['--version']).trim(), /^v24\./);
    assert.equal(execute('pnpm', cfg.pnpm, ['--version']).trim(), '10.12.1');
    execute('node-dependencies', cfg.node, ['--input-type=module', '-e', "for(const p of ['next','tsx','typescript','@playwright/test','react','ws','acorn']) console.log(p,import.meta.resolve(p))"]);
    execute('python', cfg.python, ['-c', 'import sys, importlib.metadata as m; from metagpt.team import Team; assert sys.version_info[:2] == (3,11); print(sys.executable, sys.version, m.version("metagpt"))']);
    execute('python-dependencies', cfg.uv, ['pip', 'check', '--python', cfg.python, '--offline', '--no-cache']);
    const corePaths = ['team.py', 'environment/base_env.py', 'environment/mgx/mgx_env.py', 'roles/role.py', 'roles/di/role_zero.py', 'roles/di/team_leader.py'];
    const pinned = '11cdf466d042aece04fc6cfd13b28e1a70341b1f';
    const git = args => execFileSync('git', ['-C', cfg.metagptSource, ...args], { encoding: 'utf8' });
    assert.equal(git(['rev-parse', 'HEAD']).trim(), pinned, 'MetaGPT source is not the supplied pinned revision');
    const installed = JSON.parse(execute('metagpt-identity', cfg.python, ['-c', 'import metagpt, pathlib, json, hashlib; root=pathlib.Path(metagpt.__file__).parent; paths=' + JSON.stringify(corePaths) + '; print(json.dumps({"root":str(root),"files":{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths}}))']));
    for (const path of corePaths) assert.equal(installed.files[path], sha(git(['show', pinned + ':metagpt/' + path])), 'Installed MetaGPT differs from pinned source: ' + path);
    git(['apply', '--reverse', '--check', join(cfg.candidate, 'runtime/team/optional-lancedb.patch')]);
    json('metagpt-provenance', { upstream: pinned, source: cfg.metagptSource, installed, patch: fileSha(join(cfg.candidate, 'runtime/team/optional-lancedb.patch')) });
    execute('native-runner', cfg.python, ['runtime/team/test_runner.py']);
    result = { prepared: true, node: cfg.node, python: cfg.python, configRoot, home: cfg.home, configuration: configuration() };
    writeFileSync(join(here, 'prepared.json'), JSON.stringify(result, null, 2) + '\n');
  } else if (command === 'build') {
    prepared();
    stoppedBefore('rebuilding');
    const before = source();
    execute('build', cfg.node, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {}, 600000);
    execute('prepare-assets', cfg.node, ['runtime/team/prepare.mjs']);
    assert.deepEqual(source().files, before.files, 'Product source changed during build');
    writeFileSync(join(here, 'build-source.json'), JSON.stringify({ source: source(), buildId: readFileSync(join(cfg.candidate, '.next/BUILD_ID'), 'utf8').trim() }, null, 2) + '\n');
    result = { built: true };
  } else if (command === 'start') {
    unchanged();
    processTools();
    stoppedBefore('starting');
    const port = await freePair();
    const fd = openSync(join(evidence, 'gateway.log'), 'a');
    const child = spawn(cfg.node, ['runtime/team/gateway.mjs'], { cwd: cfg.candidate, env: { ...env, PORT: String(port) }, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd); child.unref();
    const s = { pid: child.pid, processes: {}, port, url: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString(), serverLog: join(evidence, 'gateway.log') };
    try {
      writeFileSync(stateFile, JSON.stringify(s, null, 2));
      s.processes[child.pid] = processIdentity(child.pid);
      writeFileSync(stateFile, JSON.stringify(s, null, 2));
      let ready = false;
      for (let n = 0; n < 160; n++) {
        assert(alive(s.pid), 'Gateway exited; inspect server log');
        try { if ((await fetch(s.url, { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {}
        await wait(250);
      }
      assert(ready, 'Gateway did not become ready');
      s.internalPids = [...new Set(doctorModule.listeners(port + 1))];
      for (const pid of s.internalPids) s.processes[pid] = processIdentity(pid);
      writeFileSync(stateFile, JSON.stringify(s, null, 2));
      // Legacy cleanup knows to refuse removal while these processes are live.
      writeFileSync(join(here, '..', 'instance.json'), JSON.stringify({ pids: [s.pid, ...s.internalPids], ports: [port, port + 1] }, null, 2));
      await doctor(); result = s;
    } catch (error) {
      // This launch owns the fresh detached process group directly, even if OS
      // inspection failed before a persistent identity could be established.
      const groupAlive = () => { try { process.kill(-child.pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
      try {
        if (groupAlive()) process.kill(-child.pid, 'SIGTERM');
        for (let n = 0; n < 100 && groupAlive(); n++) await wait(100);
        if (groupAlive()) process.kill(-child.pid, 'SIGKILL');
        for (let n = 0; n < 50 && groupAlive(); n++) await wait(100);
        const remainingGroup = groupAlive();
        json('failed-start-cleanup', { pid: child.pid, processGroup: child.pid, port, remainingGroup, launchError: error.message });
        assert(!remainingGroup, 'Failed launch still has a live process group');
      } catch (cleanupError) {
        throw new Error(error.message + '; failed launch cleanup: ' + cleanupError.message);
      }
      throw error;
    }
  } else if (command === 'doctor') result = await doctor();
  else if (command === 'test-stop') {
    await doctor();
    const report = execute('playwright', cfg.node, ['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/team-stop.spec.ts', '--workers=1', '--retries=0', '--trace=on', '--output=' + join(evidence, 'browser'), '--reporter=json'], { TEAM_FIXTURE: '1', TEST_BASE_URL: state().url }, 300000);
    const stats = JSON.parse(report).stats;
    assert(stats.expected === 2 && stats.unexpected === 0 && stats.skipped === 0 && stats.flaky === 0, 'Expected exactly two passing native stop tests');
    unchanged(); result = stats;
  } else if (command === 'test') {
    fixedEntrypoints();
    const output = execute('unit', cfg.node, ['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/generate.test.ts', 'tests/team.test.ts', 'tests/team-socket.test.ts', 'tests/team-client.test.ts', 'tests/preview-policy.test.ts']);
    assert(/^# tests 54$/m.test(output) && ['fail', 'cancelled', 'skipped', 'todo'].every(k => new RegExp(`^# ${k} 0$`, 'm').test(output)), 'Expected 54 tests without skips'); result = { tests: 54 };
  } else if (command === 'stop') result = await stop();
  else if (command === 'exec') {
    const [bin, ...args] = process.argv.slice(3);
    assert(['node', 'pnpm', 'python'].includes(bin), 'exec supports node, pnpm, python');
    process.stdout.write(execute('exec', cfg[bin], args)); result = { executed: bin };
  } else throw new Error('Use prepare | build | start | doctor | test-stop | test | stop | exec node/pnpm/python ...');
  json('result', { passed: true, result });
  console.log(JSON.stringify({ passed: true, result, evidence }, null, 2));
} catch (error) {
  json('result', { passed: false, error: error.message });
  console.error(JSON.stringify({ passed: false, error: error.message, evidence })); process.exitCode = 1;
}
