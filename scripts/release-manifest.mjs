import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const roots = ['src/', 'public/', 'runtime/team/'];
const rootFiles = ['Dockerfile.vercel', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs'];
const required = [...rootFiles, 'runtime/team/gateway.mjs', 'runtime/team/runner.py', 'runtime/team/requirements.lock', 'runtime/team/optional-lancedb.patch', 'runtime/team/config2.yaml', 'runtime/team/review.schema.json', 'runtime/team/test_runner.py', 'runtime/team/METAGPT-LICENSE'];
const digest = (content, algorithm = 'sha256') => createHash(algorithm).update(content).digest('hex');
const allowed = file => rootFiles.includes(file) || roots.some(root => file.startsWith(root));
const unsafe = file => file.split('/').some(part => part.startsWith('.') || ['node_modules', '__pycache__', 'tx.tokens'].includes(part)) || /\.(?:pem|key|tokens?|pyc)$/.test(file);
const git = (repo, args) => execFileSync('git', args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
export const readBlob = (repo, blob) => git(repo, ['cat-file', 'blob', blob]);

// Validate the actual upload, not just the presence of files on disk. The small
// COPY grammar deliberately fails closed when the recipe gains new syntax.
export function validateFiles(files, read) {
  const paths = new Set(files.map(entry => entry.file));
  if (paths.size !== files.length) throw new Error('Duplicate release file');
  for (const file of paths) if (!allowed(file) || unsafe(file)) throw new Error(`Unsafe release path: ${file}`);
  for (const file of required) if (!paths.has(file)) throw new Error(`Missing release input: ${file}`);
  for (const root of roots) if (![...paths].some(file => file.startsWith(root))) throw new Error(`Empty release directory: ${root}`);
  const instructions = read('Dockerfile.vercel').toString().split('\n')
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    .map(line => {
      const match = /^([a-z]+)\s+(.+)$/i.exec(line);
      if (!match || line.endsWith('\\')) throw new Error('Unsupported Docker instruction; review release validation');
      return { name: match[1].toUpperCase(), value: match[2] };
    });
  const finalStage = instructions.findLastIndex(instruction => instruction.name === 'FROM');
  if (finalStage < 0 || !/^python:3\.11[\w.-]+$/i.test(instructions[finalStage].value)) throw new Error('Final container stage must supply Python 3.11');
  const runtime = instructions.slice(finalStage + 1);
  const commands = runtime.filter(instruction => instruction.name === 'CMD');
  if (commands.length !== 1 || commands[0].value !== '["node", "runtime/team/gateway.mjs"]') throw new Error('Final container stage must start the team gateway with exactly one CMD');
  if (!runtime.some(instruction => instruction.name === 'RUN' && instruction.value.includes('pip check') && instruction.value.includes('python runtime/team/test_runner.py'))) throw new Error('Missing Python runtime/build gates');
  const stages = new Set();
  for (const { name, value } of instructions) {
    if (!['FROM', 'RUN', 'WORKDIR', 'COPY', 'ENV', 'EXPOSE', 'CMD'].includes(name)) throw new Error(`Unsupported Docker instruction: ${name}`);
    if (name === 'FROM') {
      const stage = / AS (\w+)$/i.exec(value)?.[1];
      if (stage) stages.add(stage);
    }
    if (name !== 'COPY') continue;
    const words = value.split(/\s+/);
    const from = /^--from=(\w+)$/.exec(words[0]);
    if (from) {
      if (!stages.has(from[1])) throw new Error('Unsupported Docker COPY stage');
      words.shift();
    }
    const destination = words.pop();
    if (!destination || !/^[\w.@/-]+$/.test(destination) || !words.length || words.some(word => !/^[\w.@/-]+$/.test(word) || word.split('/').includes('..') || (!from && (word.startsWith('/') || word === '.')))) throw new Error('Unsupported Docker COPY; update release input validation');
    if (from) continue;
    for (const source of words) {
      const normalized = source.replace(/^\.\//, '').replace(/\/$/, '');
      if (!paths.has(normalized) && ![...paths].some(file => file.startsWith(normalized + '/'))) throw new Error(`Missing Docker COPY source: ${source}`);
    }
  }
}

export function buildManifest(repo, ref) {
  const commit = git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const entries = git(repo, ['ls-tree', '-rz', '--full-tree', commit]).toString().split('\0').filter(Boolean);
  const contents = new Map();
  const files = [];
  for (const entry of entries) {
    const [metadata, file] = entry.split('\t');
    if (!allowed(file)) continue;
    const [mode, type, blob] = metadata.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`Non-regular release input: ${file}`);
    const content = readBlob(repo, blob);
    contents.set(file, content);
    files.push({ file, blob, sha256: digest(content), sha1: digest(content, 'sha1'), size: content.length });
  }
  validateFiles(files, file => contents.get(file));
  return { version: 1, commit, sourceDigest: digest(JSON.stringify(files)), files };
}

export function validateManifest(repo, manifest) {
  const expected = buildManifest(repo, manifest.commit);
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('Manifest differs from frozen Git source; regenerate it');
  return expected;
}
