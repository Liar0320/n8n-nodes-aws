import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guard = fileURLToPath(new URL('../scripts/check-release-source.mjs', import.meta.url));

test('release source rejects feature tags until merged and accepts historical main commits', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aws-release-source-'));
  const repository = path.join(root, 'repository');
  const git = (args, cwd = repository) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const check = (cwd = repository) => spawnSync(process.execPath, [guard], { cwd, encoding: 'utf8' });
  try {
    git(['init', '--initial-branch=main', repository], root);
    git(['config', 'user.name', 'Release Test']);
    git(['config', 'user.email', 'release@example.invalid']);
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base']);
    assert.notEqual(check().status, 0, 'Missing origin/main must fail closed');
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['checkout', '-b', 'feature']);
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'unmerged release']);
    git(['tag', '-a', 'v1.0.0', '-m', 'candidate']);
    git(['checkout', '--detach', 'v1.0.0']);
    assert.notEqual(check().status, 0, 'An unmerged annotated feature tag must fail');
    const releaseCommit = git(['rev-parse', 'HEAD']);
    git(['checkout', 'main']);
    git(['-c', 'commit.gpgsign=false', 'merge', '--no-ff', 'feature', '-m', 'merge release']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['checkout', '--detach', 'v1.0.0']);
    assert.equal(check().status, 0, 'The same immutable tag is valid after a merge commit includes it');
    git(['checkout', 'main']);
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'later main change']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(['checkout', '--detach', releaseCommit]);
    assert.equal(check().status, 0, 'A historical main commit must remain releasable');
    const shallow = path.join(root, 'shallow');
    git(['clone', '--depth=1', '--branch=main', `file://${repository}`, shallow], root);
    const rejected = check(shallow);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /full history/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
