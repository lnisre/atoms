import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildManifest, validateFiles, validateManifest, verifyDeployment, project, readBlob } from '../scripts/release-manifest.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const manifest = buildManifest(repo, 'HEAD');
const read = file => readBlob(repo, manifest.files.find(entry => entry.file === file).blob);

test('release includes the container, Python dependencies, all application source and fixed examples', () => {
  assert.ok(manifest.files.some(entry => entry.file === 'Dockerfile.vercel'));
  assert.ok(manifest.files.some(entry => entry.file === 'runtime/team/requirements.lock'));
  assert.ok(manifest.files.some(entry => entry.file === 'public/examples/tip-calculator-v1.html'));
  assert.ok(manifest.files.every(entry => !/^(docs|tests|node_modules|\.env)/.test(entry.file)));
  validateFiles(manifest.files, read);
});

test('the exact historical omission is blocked before any upload', () => {
  assert.throws(() => validateFiles(manifest.files.filter(entry => entry.file !== 'Dockerfile.vercel'), read), /Missing release input: Dockerfile.vercel/);
});

test('Python runner, pinned dependencies, patch, config and schema cannot be omitted', () => {
  for (const file of ['runner.py', 'requirements.lock', 'optional-lancedb.patch', 'config2.yaml', 'review.schema.json']) {
    assert.throws(() => validateFiles(manifest.files.filter(entry => entry.file !== `runtime/team/${file}`), read), /Missing release input/);
  }
});

test('new Docker COPY inputs and unsupported syntax fail closed', () => {
  for (const copy of ['COPY deployment/new-input.json /app/', 'COPY . /app/', 'COPY ["new.json", "/app/"]']) {
    assert.throws(() => validateFiles(manifest.files, file => file === 'Dockerfile.vercel' ? `${read(file)}\n${copy}` : read(file)), /Missing Docker COPY|Unsupported Docker COPY/);
  }
});

test('ordinary Next entry or missing Python build gates cannot masquerade as a team container', () => {
  for (const dockerfile of [read('Dockerfile.vercel').toString().replace('CMD ["node", "runtime/team/gateway.mjs"]', 'CMD ["node", "server.js"]'), read('Dockerfile.vercel').toString().replace('python runtime/team/test_runner.py', 'true')]) {
    assert.throws(() => validateFiles(manifest.files, file => file === 'Dockerfile.vercel' ? dockerfile : read(file)), /team gateway|Python runtime/);
  }
});

test('credentials and workspace caches are never valid upload inputs', () => {
  for (const file of ['.vercel_atoms_agent.token', '.env.local', 'runtime/team/.env', 'src/secret.key', 'runtime/team/__pycache__/runner.pyc']) {
    assert.throws(() => validateFiles([...manifest.files, { file }], read), /Unsafe release path/);
  }
});

test('frozen Git content is reproducible and rejects tampering, extra files and partial directory uploads', () => {
  assert.deepEqual(buildManifest(repo, manifest.commit), manifest);
  validateManifest(repo, manifest);
  for (const changed of [
    { ...manifest, files: manifest.files.slice(1) },
    { ...manifest, files: manifest.files.filter(entry => entry.file !== 'src/app/page.tsx') },
    { ...manifest, sourceDigest: 'forged' },
    { ...manifest, files: manifest.files.map((entry, i) => i ? entry : { ...entry, sha256: 'forged' }) },
  ]) assert.throws(() => validateManifest(repo, changed), /differs from frozen Git/);
});

function remote() {
  const deployment = { id: 'dpl_test', url: 'example.vercel.app', readyState: 'READY', target: 'production', projectId: project, meta: { sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest } };
  // API paths under the top-level src directory are the uploaded source tree.
  const tree = [{ name: 'src', type: 'directory', children: manifest.files.map(({ file, sha1 }) => ({ name: file, type: 'file', uid: sha1 })) }];
  const builds = { builds: [{ output: [{ path: 'container', digest: 'project/image', lambda: { runtime: 'container' } }] }] };
  return { deployment, alias: { id: deployment.id }, tree, builds };
}
const verify = ({ deployment, alias, tree, builds }) => verifyDeployment(manifest, deployment, alias, tree, builds);

test('READY and matching metadata are insufficient without container output and exact remote source', () => {
  assert.equal(verify(remote()).container.runtime, 'container');
  const cases = [
    value => { value.builds.builds[0].output[0].lambda.runtime = 'nodejs'; },
    value => { value.tree[0].children = value.tree[0].children.filter(entry => entry.name !== 'Dockerfile.vercel'); },
    value => { value.tree[0].children[0].uid = 'different-content'; },
    value => { value.alias.id = 'dpl_other'; },
    value => { value.deployment.meta.sourceCommit = 'other'; },
    value => { value.deployment.projectId = 'other'; },
  ];
  for (const mutate of cases) { const value = remote(); mutate(value); assert.throws(() => verify(value)); }
});

test('working Docker recipe still meets the same gate before commit', () => {
  validateFiles(manifest.files, file => readFileSync(new URL(`../${file}`, import.meta.url)));
});
