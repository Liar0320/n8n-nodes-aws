import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Release source check failed: git ${args.join(' ')}\n${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

try {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Release source check requires full history; use checkout fetch-depth: 0.');
  }
  const commit = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  git(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
  git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  console.log(`Release source verified: ${commit} belongs to origin/main history.`);
} catch (error) {
  console.error(error.message);
  console.error('Merge the release changes into main before creating the version tag. Do not move published tags.');
  process.exitCode = 1;
}
