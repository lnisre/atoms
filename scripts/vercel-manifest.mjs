export const project = 'prj_eErnQuAz4P719xKTyuT6XT2Qu5ab';
export const team = 'team_brlKMv4xsRX1SFiSIq5cMbfj';
export const productionOrigin = 'https://v0-test0-nine.vercel.app';

function flatten(nodes, prefix = '') {
  return nodes.flatMap(node => node.type === 'directory' ? flatten(node.children ?? [], `${prefix}${node.name}/`) : [{ file: prefix + node.name, sha1: node.uid }]);
}

export function verifyDeployment(manifest, deployment, alias, tree, builds, isolatedFrom) {
  if (deployment.readyState !== 'READY' || deployment.target !== 'production' || deployment.projectId !== project || alias.id !== (isolatedFrom ?? deployment.id) || (isolatedFrom && (deployment.id === isolatedFrom || deployment.autoAssignCustomDomains !== false))) throw new Error('Production deployment/alias identity mismatch');
  if (deployment.meta?.sourceCommit !== manifest.commit || deployment.meta?.sourceDigest !== manifest.sourceDigest) throw new Error('Deployment source metadata mismatch');
  const source = tree.find(node => node.type === 'directory' && node.name === 'src');
  const actual = flatten(source?.children ?? []).sort((a, b) => a.file.localeCompare(b.file));
  const expected = manifest.files.map(({ file, sha1 }) => ({ file, sha1 })).sort((a, b) => a.file.localeCompare(b.file));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Remote source files differ from upload manifest');
  const outputs = builds.builds.flatMap(build => build.output ?? []);
  const container = outputs.find(output => output.path === 'container' && output.lambda?.runtime === 'container' && output.digest);
  if (!container || outputs.some(output => output.lambda && output.lambda.runtime !== 'container')) throw new Error('Missing container output or unexpected serverless runtime');
  return { deploymentId: deployment.id, deploymentURL: `https://${deployment.url}`, target: deployment.target, readyState: deployment.readyState, sourceCommit: manifest.commit, sourceDigest: manifest.sourceDigest, sourceFiles: actual.length, productionOrigin, isolated: !!isolatedFrom, aliasDeploymentId: alias.id, container: { path: container.path, runtime: container.lambda.runtime, digest: container.digest }, checkedAt: new Date().toISOString() };
}
