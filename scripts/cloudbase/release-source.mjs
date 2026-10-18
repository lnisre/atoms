import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readBlob, validateManifest } from '../release-manifest.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function createSourcePackage(repo, manifest, directory, secrets = []) {
  validateManifest(repo, manifest);
  const files = manifest.files.map(entry => ({ ...entry, content: readBlob(repo, entry.blob) }));
  const marker = Buffer.from(JSON.stringify({ protocol: 'atoms-team/3', sourceCommit: manifest.commit,
    sourceDigest: manifest.sourceDigest }) + '\n');
  files.push({ file: 'Dockerfile', content: files.find(entry => entry.file === 'Dockerfile.vercel').content },
    { file: 'runtime/team/release.json', content: marker });
  if (new Set(files.map(entry => entry.file)).size !== files.length) throw Error('Generated release input collision');
  const context = resolve(directory, 'context'); mkdirSync(context);
  const inputs = [];
  for (const { file, content } of files) {
    if (secrets.filter(value => value?.length >= 16).some(value => content.includes(Buffer.from(value)))) throw Error('Credential found in frozen source');
    mkdirSync(dirname(resolve(context, file)), { recursive: true });
    writeFileSync(resolve(context, file), content, { flag: 'wx', mode: 0o600 });
    inputs.push({ file, sha256: digest(content), size: content.length });
  }
  // Zip only this fresh allowlisted directory. Deterministic ZIP metadata makes
  // the complete upload reproducible, without packaging the dirty checkout.
  const archive = resolve(directory, 'source.zip');
  execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file():\n   i=zipfile.ZipInfo(f.relative_to(p).as_posix(),(1980,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,f.read_bytes())', context, archive]);
  const bytes = readFileSync(archive);
  return { inputs, archiveSha256: digest(bytes), archiveBytes: bytes.length,
    recipe: { from: 'Dockerfile.vercel', to: 'Dockerfile' }, generated: ['Dockerfile', 'runtime/team/release.json'] };
}

// A build's push line identifies the registry manifest digest. Arbitrary layer
// hashes are intentionally not accepted. The caller binds this to BuildId.
export function pushedImageDigest(log) {
  const values = [...String(log).matchAll(/\b[\w.-]+:\s+digest:\s*(sha256:[a-f\d]{64})\s+size:\s*\d+\b/g)].map(match => match[1]);
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw Error('Unique pushed image manifest digest unavailable');
  return unique[0];
}
export function immutableImage(imageUrl, imageDigest) {
  if (!/^[a-z\d.-]+(?::\d+)?\/[a-z\d_./-]+(?::[\w.-]+)?(?:@sha256:[a-f\d]{64})?$/.test(imageUrl)
    || !/^sha256:[a-f\d]{64}$/.test(imageDigest)) throw Error('Invalid immutable image identity');
  if (imageUrl.includes('@') && !imageUrl.endsWith('@' + imageDigest)) throw Error('Image digest mismatch');
  return imageUrl.split('@')[0].replace(/:[^/]+$/, '') + '@' + imageDigest;
}
