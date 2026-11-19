import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function releaseVersion(tag, packageVersion) {
  assert.equal(typeof tag, 'string', 'A version tag is required');
  assert.ok(tag.startsWith('v'), 'Release tag must start with v');
  const version = tag.slice(1);
  const match = semver.exec(version);
  assert.ok(match && match[0] === version, `Release tag is not an exact SemVer version: ${tag}`);
  const prerelease = match[4];
  assert.ok(!prerelease?.split('.').some((part) => /^0\d+$/.test(part)),
    'Numeric prerelease identifiers must not have leading zeros');
  assert.equal(version, packageVersion, 'Release tag must exactly match package.json version');
  return { version, prerelease: Boolean(prerelease), distTag: prerelease ? 'next' : 'latest' };
}

export function changelogNotes(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## (?:\\[${escaped}\\]|${escaped})(?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
  const match = heading.exec(changelog);
  assert.ok(match, `CHANGELOG.md has no exact release section for ${version}`);
  const remainder = changelog.slice(match.index + match[0].length);
  const nextHeading = /^##\s/m.exec(remainder);
  const notes = remainder.slice(0, nextHeading?.index ?? remainder.length).trim();
  assert.ok(notes.replace(/<!--[\s\S]*?-->/g, '').trim(),
    `CHANGELOG.md release notes for ${version} are empty`);
  return `${notes}\n`;
}

export function assertUnpublished(result, packageName, version) {
  const spec = `${packageName}@${version}`;
  if (result.error || result.signal || result.status === null) {
    throw new Error(`Cannot check npm registry for ${spec}: ${result.error?.message ?? result.signal ?? 'npm did not exit'}`);
  }
  assert.notEqual(result.status, 0,
    `${spec} already exists on npm. Duplicate publication is forbidden; do not rerun publishing after a partial release.`);
  const errors = [result.stdout, result.stderr].flatMap((text) => {
    try {
      return [JSON.parse(text.trim())];
    } catch {
      return [];
    }
  });
  assert.ok(errors.some((value) => value?.error?.code === 'E404'),
    `Cannot verify ${spec} is unpublished: npm registry check failed (only a structured E404 permits publication).\n${result.stderr || result.stdout}`);
}

export async function checkedArtifact(packageJson, root = process.cwd()) {
  const directory = path.join(root, '.artifacts/package');
  const artifact = JSON.parse(await readFile(path.join(directory, 'pack-result.json'), 'utf8'));
  assert.equal(artifact.name, packageJson.name, 'Checked artifact name mismatch');
  assert.equal(artifact.version, packageJson.version, 'Checked artifact version mismatch');
  assert.equal(path.basename(artifact.filename), artifact.filename, 'Unsafe checked artifact filename');
  assert.match(artifact.filename, /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/, 'Invalid checked artifact filename');
  const relativePath = `.artifacts/package/${artifact.filename}`;
  assert.equal(artifact.path, relativePath, 'Checked artifact path mismatch');
  const bytes = await readFile(path.join(directory, artifact.filename));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, artifact.integrity, 'Checked artifact changed after npm run check:pack');
  return relativePath;
}

async function main() {
  const [tag, mode] = process.argv.slice(2);
  assert.ok(mode === undefined || mode === '--notes-only', 'Usage: node scripts/release-metadata.mjs v<version> [--notes-only]');
  assert.ok(process.argv.length <= 5, 'Unexpected release metadata arguments');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const release = releaseVersion(tag, packageJson.version);
  const notes = changelogNotes(await readFile('CHANGELOG.md', 'utf8'), release.version);
  const outputs = {
    version: release.version,
    dist_tag: release.distTag,
    prerelease: String(release.prerelease),
    notes_file: '.artifacts/release-notes.md',
  };
  if (mode !== '--notes-only') {
    outputs.artifact = await checkedArtifact(packageJson);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, [
      'view', `${packageJson.name}@${release.version}`, 'version', '--json',
      '--registry=https://registry.npmjs.org/',
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assertUnpublished(result, packageJson.name, release.version);
  }
  await mkdir('.artifacts', { recursive: true });
  await writeFile(outputs.notes_file, notes);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT,
      Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(JSON.stringify(outputs));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
