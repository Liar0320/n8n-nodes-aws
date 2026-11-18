import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactDirectory = path.resolve('.artifacts/package');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const requiredFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'docs/releases.md',
  'docs/redis-html-cdn.md',
  'docs/verification.md',
  'examples/cloudfront-invalidation.json',
  'dist/credentials/AwsCloudFrontApi.credentials.js',
  'dist/nodes/CloudFront/AwsCloudFront.node.js',
  'dist/nodes/CloudFront/cloudfront.svg',
  'dist/nodes/CloudFront/AwsCloudFront.node.json',
  'dist/shared/aws.js',
];
const rootFiles = new Set(requiredFiles.filter((file) => !file.startsWith('dist/')));
const compiledFiles = /^dist\/(?:credentials\/AwsCloudFrontApi\.credentials|nodes\/CloudFront\/(?:AwsCloudFront\.node|helpers|properties)|shared\/aws)\.(?:js|d\.ts|js\.map)$/;
const assets = new Set([
  'dist/nodes/CloudFront/cloudfront.svg',
  'dist/nodes/CloudFront/AwsCloudFront.node.json',
]);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bnpm_[A-Za-z0-9]{36,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
];

await mkdir(artifactDirectory, { recursive: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packed = JSON.parse(execFileSync(npm, [
  'pack', '--json', '--ignore-scripts', '--pack-destination', artifactDirectory,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
assert.equal(packed.length, 1, 'npm pack must produce exactly one artifact');
const result = packed[0];
assert.equal(path.basename(result.filename), result.filename, 'Unsafe artifact filename');
assert.match(result.filename, /\.tgz$/, 'Expected an npm tarball');
const artifactPath = path.join(artifactDirectory, result.filename);
const entries = execFileSync('tar', ['-tzf', artifactPath], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).trim().split('\n').filter((entry) => !entry.endsWith('/'));
const files = entries.map((entry) => {
  assert.ok(entry.startsWith('package/'), `Unexpected archive root: ${entry}`);
  const file = entry.slice('package/'.length);
  assert.ok(rootFiles.has(file) || compiledFiles.test(file) || assets.has(file),
    `Unexpected packed file (source, tests, secrets, or unrelated output): ${file}`);
  return file;
});
assert.equal(new Set(files).size, files.length, 'Duplicate archive entries are forbidden');
assert.deepEqual([...files].sort(), result.files.map(({ path: file }) => file).sort(),
  'npm manifest and actual archive disagree');
for (const file of requiredFiles) {
  assert.ok(files.includes(file), `Required file missing from package: ${file}`);
}

let manifest;
for (const file of files) {
  const contents = execFileSync('tar', ['-xOf', artifactPath, `package/${file}`], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  for (const pattern of secretPatterns) {
    assert.ok(!pattern.test(contents), `Possible secret found in packed file: ${file}`);
  }
  if (file.endsWith('.js.map')) {
    const map = JSON.parse(contents);
    assert.ok(!map.sourcesContent?.some((source) => source !== null),
      `Embedded source is forbidden in source map: ${file}`);
  }
  if (file === 'package.json') manifest = JSON.parse(contents);
}
assert.equal(manifest.name, packageJson.name, 'Packed package name changed');
assert.equal(manifest.version, packageJson.version, 'Packed package version changed');
assert.deepEqual(manifest.n8n?.nodes, ['dist/nodes/CloudFront/AwsCloudFront.node.js'],
  'AWS CloudFront must be the sole registered node');
assert.deepEqual(manifest.n8n?.credentials, ['dist/credentials/AwsCloudFrontApi.credentials.js'],
  'AWS CloudFront credentials must be registered');
for (const file of [...manifest.n8n.nodes, ...manifest.n8n.credentials]) {
  assert.ok(files.includes(file), `Registered runtime is missing: ${file}`);
}
const integrity = `sha512-${createHash('sha512').update(await readFile(artifactPath)).digest('base64')}`;
assert.equal(integrity, result.integrity, 'Packed artifact integrity does not match npm');
const metadata = {
  name: manifest.name,
  version: manifest.version,
  filename: result.filename,
  path: path.relative(process.cwd(), artifactPath),
  integrity,
};
await writeFile(path.join(artifactDirectory, 'pack-result.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Checked ${metadata.path}: ${files.length} allowlisted files (${integrity})`);
