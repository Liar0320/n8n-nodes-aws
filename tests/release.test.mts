import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertUnpublished,
  changelogNotes,
  checkedArtifact,
  releaseVersion,
} from '../scripts/release-metadata.mjs';

test('release tags require exact SemVer and package version equality', () => {
  assert.deepEqual(releaseVersion('v1.2.3', '1.2.3'), {
    version: '1.2.3', prerelease: false, distTag: 'latest',
  });
  assert.deepEqual(releaseVersion('v1.2.3-rc.2', '1.2.3-rc.2'), {
    version: '1.2.3-rc.2', prerelease: true, distTag: 'next',
  });
  assert.equal(releaseVersion('v1.2.3-0.alpha-1+build.04', '1.2.3-0.alpha-1+build.04').distTag, 'next');
  assert.equal(releaseVersion('v1.2.3+build.04', '1.2.3+build.04').distTag, 'latest');
  for (const tag of [
    '1.2.3', 'v1.2', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-01',
    'v1.2.3-rc.01', 'v1.2.3-', 'v1.2.3+', 'v1.2.3-rc..1', 'v1.2.3\n',
    'vv1.2.3', 'v1.2.3 beta',
  ]) {
    assert.throws(() => releaseVersion(tag, tag.slice(1)), undefined, tag);
  }
  assert.throws(() => releaseVersion('v1.2.3', '1.2.4'), /exactly match/);
  assert.throws(() => releaseVersion(undefined, '1.2.3'), /required/);
});

test('release notes use only the matching checked-in changelog section', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\nFuture work\n\n## [1.2.3] - 2026-11-18\n\n### Fixed\n\n- Actual shipped fix.\n\n## [1.2.2] - 2026-11-17\n\n- Older fix.\n';
  assert.equal(changelogNotes(changelog, '1.2.3'), '### Fixed\n\n- Actual shipped fix.\n');
  assert.equal(changelogNotes('## 1.2.3-rc.1\n\n- Candidate.\n', '1.2.3-rc.1'), '- Candidate.\n');
  assert.throws(() => changelogNotes(changelog, '1.2.30'), /no exact release section/);
  assert.throws(() => changelogNotes('## [1.2.3]\n\n## [1.2.2]\n- Old.\n', '1.2.3'), /empty/);
  assert.throws(() => changelogNotes('## [1.2.3]\n<!-- pending -->\n', '1.2.3'), /empty/);
});

test('npm precheck permits only explicit structured E404 absence', () => {
  const absent = { status: 1, stdout: '{"error":{"code":"E404"}}', stderr: '' };
  assert.doesNotThrow(() => assertUnpublished(absent, 'n8n-nodes-aws', '1.2.3'));
  assert.doesNotThrow(() => assertUnpublished({ ...absent, stdout: '', stderr: absent.stdout }, 'n8n-nodes-aws', '1.2.3'));
  assert.throws(() => assertUnpublished({ status: 0, stdout: '"1.2.3"', stderr: '' }, 'n8n-nodes-aws', '1.2.3'), /already exists/);
  for (const result of [
    { status: 1, stdout: '{"error":{"code":"E500"}}', stderr: 'registry failed' },
    { status: 1, stdout: '', stderr: 'npm error code E404' },
    { status: 1, stdout: '', stderr: 'network timeout' },
    { status: 1, stdout: '{"error":{"code":"E401"}}', stderr: '' },
    { status: null, stdout: '', stderr: '', error: new Error('npm unavailable') },
    { status: null, stdout: '', stderr: '', signal: 'SIGTERM' },
  ]) {
    assert.throws(() => assertUnpublished(result, 'n8n-nodes-aws', '1.2.3'), /Cannot (?:verify|check)/);
  }
});

test('publishing consumes only the previously checked, unchanged tarball', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'n8n-aws-release-'));
  const directory = path.join(root, '.artifacts/package');
  const bytes = Buffer.from('deterministic checked artifact');
  const metadata = {
    name: 'n8n-nodes-aws', version: '1.2.3', filename: 'n8n-nodes-aws-1.2.3.tgz',
    path: '.artifacts/package/n8n-nodes-aws-1.2.3.tgz',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  const manifest = { name: 'n8n-nodes-aws', version: '1.2.3' };
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, metadata.filename), bytes);
    await writeFile(path.join(directory, 'pack-result.json'), JSON.stringify(metadata));
    assert.equal(await checkedArtifact(manifest, root), metadata.path);
    await assert.rejects(checkedArtifact({ ...manifest, version: '1.2.4' }, root), /version mismatch/);
    await assert.rejects(checkedArtifact({ ...manifest, name: 'another-package' }, root), /name mismatch/);
    await writeFile(path.join(directory, metadata.filename), 'changed after validation');
    await assert.rejects(checkedArtifact(manifest, root), /changed after/);
    await writeFile(path.join(directory, 'pack-result.json'), JSON.stringify({ ...metadata, filename: '../escape.tgz' }));
    await assert.rejects(checkedArtifact(manifest, root), /Unsafe/);
    await writeFile(path.join(directory, 'pack-result.json'), JSON.stringify({ ...metadata, path: 'elsewhere.tgz' }));
    await assert.rejects(checkedArtifact(manifest, root), /path mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
