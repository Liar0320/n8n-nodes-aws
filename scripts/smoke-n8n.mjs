import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const n8nVersion = '2.48.4';
const repository = fileURLToPath(new URL('..', import.meta.url));
const artifact = JSON.parse(await readFile(path.join(repository, '.artifacts/package/pack-result.json'), 'utf8'));
assert.equal(artifact.name, 'n8n-nodes-aws');
assert.equal(path.basename(artifact.filename), artifact.filename);
assert.match(artifact.filename, /\.tgz$/);
const tarball = path.resolve(repository, artifact.path);
assert.equal(tarball, path.join(repository, '.artifacts/package', artifact.filename));
assert.equal(`sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`, artifact.integrity,
  'The packed artifact changed after check:pack');
assert.equal(process.versions.node.split('.')[0], '24', 'Run the smoke with Node.js 24');

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'n8n-aws-smoke-')));
const home = path.join(root, 'home');
const userFolder = path.join(root, 'user');
const community = path.join(userFolder, '.n8n', 'nodes');
const runtime = process.env.N8N_SMOKE_RUNTIME ? path.resolve(process.env.N8N_SMOKE_RUNTIME) : path.join(root, 'runtime');
const fakeCredentials = {
  accessKeyId: 'SMOKE_FAKE_ACCESS_KEY',
  secretAccessKey: 'smoke-fake-secret-not-an-aws-credential',
  sessionToken: 'smoke-fake-session-token',
};
async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return String(port);
}
// Deliberately do not inherit AWS_*, N8N_*, proxy settings, NODE_OPTIONS, or npm user configuration.
const environment = {
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
  HOME: home,
  USERPROFILE: home,
  TMPDIR: root,
  TMP: root,
  TEMP: root,
  LANG: 'en_US.UTF-8',
  CI: 'true',
  NO_COLOR: '1',
  npm_config_cache: path.join(root, 'npm-cache'),
  npm_config_userconfig: path.join(root, 'empty-npmrc'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  N8N_USER_FOLDER: userFolder,
  N8N_ENCRYPTION_KEY: 'isolated-smoke-only-not-a-production-encryption-key',
  N8N_DIAGNOSTICS_ENABLED: 'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
  N8N_TEMPLATES_ENABLED: 'false',
  N8N_PERSONALIZATION_ENABLED: 'false',
  N8N_COMMUNITY_PACKAGES_ENABLED: 'true',
  N8N_COMMUNITY_PACKAGES_PREVENT_LOADING: 'false',
  // BaseCommand.log forwards execution JSON through logger.info, including --rawOutput.
  N8N_LOG_LEVEL: 'info',
  NODE_PATH: path.join(runtime, 'node_modules'),
  // n8n 2.48 always starts its task broker, even without Code nodes.
  N8N_RUNNERS_BROKER_PORT: await availablePort(),
  N8N_PORT: await availablePort(),
  N8N_RUNNERS_BROKER_LISTEN_ADDRESS: '127.0.0.1',
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_SHARED_CREDENTIALS_FILE: path.join(root, 'empty-aws-credentials'),
  AWS_CONFIG_FILE: path.join(root, 'empty-aws-config'),
};
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, extraEnv = {}, cwd = root) {
  const result = spawnSync(command, args, {
    cwd, env: { ...environment, ...extraEnv }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`, { cause: result.error });
  }
  return result.stdout;
}
function parseExecution(stdout) {
  // n8n --rawOutput still permits initialization messages before the execution JSON.
  for (const match of stdout.matchAll(/^\s*\{/gm)) {
    try {
      const value = JSON.parse(stdout.slice(match.index));
      if (value.data?.resultData) return value;
    } catch { /* This opening brace belongs to an earlier initialization message. */ }
  }
  throw new Error(`n8n did not return execution data:\n${stdout}`);
}
const date = '2026-01-02T03:04:05.000Z';
const distribution = (id) => ({
  Id: id, ARN: `arn:aws:cloudfront::000000000000:distribution/${id}`, DomainName: `${id.toLowerCase()}.cloudfront.net`,
  Status: 'Deployed', Enabled: true, LastModifiedTime: date, Aliases: { Quantity: 0, Items: [] },
});
const invalidation = (id, callerReference = 'smoke-reference', paths = ['/index.html']) => ({
  Id: id, Status: 'Completed', CreateTime: date,
  InvalidationBatch: { CallerReference: callerReference, Paths: { Quantity: paths.length, Items: paths } },
});
const response = (requestId, body) => ({ ...body, $metadata: { httpStatusCode: 200, requestId } });
const call = (command, input, output) => ({ command, input, output });
const cases = [
  {
    operation: 'listDistributions',
    inputs: [{ label: 'two-pages', returnAll: true }, { label: 'empty-page', marker: 'empty' }, { label: 'one-page', returnAll: false }],
    calls: [
      call('ListDistributionsCommand', { MaxItems: 1 }, response('distribution-page-1', { DistributionList: { Items: [distribution('D1')], IsTruncated: true, NextMarker: 'page2' } })),
      call('ListDistributionsCommand', { MaxItems: 1, Marker: 'page2' }, response('distribution-page-2', { DistributionList: { Items: [distribution('D2')], IsTruncated: false } })),
      call('ListDistributionsCommand', { MaxItems: 1, Marker: 'empty' }, response('distribution-empty', { DistributionList: { Items: [], IsTruncated: false } })),
      call('ListDistributionsCommand', { MaxItems: 1 }, response('distribution-single', { DistributionList: { Items: [distribution('D1')], IsTruncated: true, NextMarker: 'page2' } })),
    ],
    verify(items) {
      assert.deepEqual(items[0].json.distributions.map((item) => item.distributionId), ['D1', 'D2']);
      assert.equal(items[0].json.nextMarker, null);
      assert.deepEqual(items[0].json.requestIds, ['distribution-page-1', 'distribution-page-2']);
      assert.deepEqual(items[1].json.distributions, []);
      assert.equal(items[1].json.nextMarker, null);
      assert.equal(items[2].json.nextMarker, 'page2');
      assert.equal(items[2].json.isTruncated, true);
    },
  },
  {
    operation: 'getDistribution',
    inputs: [{ label: 'first-id', distributionId: 'D1' }, { label: 'second-id', distributionId: 'D2' }, { label: 'local-error', distributionId: 'not an ID' }, { label: 'aws-error', distributionId: 'DENIED' }],
    calls: [
      ...['D1', 'D2'].map((id) => call('GetDistributionCommand', { Id: id }, response(`get-${id}`, {
        Distribution: { ...distribution(id), InProgressInvalidationBatches: 0, DistributionConfig: { Enabled: true, Aliases: { Items: [] }, Comment: 'smoke', Origins: { Items: [{ Id: 'origin', DomainName: 'example.invalid' }] } } }, ETag: `etag-${id}`,
      }))),
      { command: 'GetDistributionCommand', input: { Id: 'DENIED' }, error: { name: 'AccessDenied', message: `must-not-leak:${fakeCredentials.secretAccessKey}`, $metadata: { httpStatusCode: 403, requestId: 'denied-request' } } },
    ],
    verify(items) {
      assert.deepEqual(items.slice(0, 2).map((item) => item.json.distributionId), ['D1', 'D2']);
      assert.equal(items[0].json.etag, 'etag-D1');
      assert.equal(items[0].json.lastModifiedTime, date);
      assert.deepEqual(items[0].json.origins, [{ id: 'origin', domainName: 'example.invalid', originPath: '' }]);
      assert.equal(items[2].json.error.code, 'ValidationError');
      assert.equal(items[3].json.error.code, 'AccessDenied');
      assert.equal(items[3].json.error.httpStatus, 403);
      assert.equal(items[3].json.error.requestId, 'denied-request');
      assert.ok(!JSON.stringify(items).includes('must-not-leak'));
      assert.ok(!JSON.stringify(items).includes(fakeCredentials.secretAccessKey));
    },
  },
  {
    operation: 'createInvalidation',
    inputs: [
      { label: 'explicit-paths', distributionId: 'D1', callerReference: 'ref-1', paths: '/index.html\n/assets/*\n/index.html' },
      { label: 'second-batch', distributionId: 'D2', callerReference: 'ref-2', paths: '/keep%20encoded?q=1' },
      { label: 'invalid-path', distributionId: 'D3', callerReference: 'ref-3', paths: 'https://example.invalid/unsafe' },
    ],
    calls: [
      ...[
        { distributionId: 'D1', callerReference: 'ref-1', paths: ['/index.html', '/assets/*'], id: 'I1' },
        { distributionId: 'D2', callerReference: 'ref-2', paths: ['/keep%20encoded?q=1'], id: 'I2' },
      ].map(({ distributionId, callerReference, paths, id }) => call('CreateInvalidationCommand', {
        DistributionId: distributionId, InvalidationBatch: { CallerReference: callerReference, Paths: { Quantity: paths.length, Items: paths } },
      }, response(`create-${id}`, { Invalidation: invalidation(id, callerReference, paths) }))),
    ],
    verify(items) {
      assert.deepEqual(items[0].json.paths, ['/index.html', '/assets/*']);
      assert.equal(items[0].json.callerReference, 'ref-1');
      assert.deepEqual(items[1].json.paths, ['/keep%20encoded?q=1']);
      assert.equal(items[1].json.distributionId, 'D2');
      assert.equal(items[2].json.error.code, 'ValidationError');
    },
  },
  {
    operation: 'getInvalidation',
    inputs: [{ label: 'first-invalidation', distributionId: 'D1', invalidationId: 'I1' }, { label: 'second-invalidation', distributionId: 'D2', invalidationId: 'I2' }],
    calls: ['1', '2'].map((suffix) => call('GetInvalidationCommand', { DistributionId: `D${suffix}`, Id: `I${suffix}` }, response(`invalidation-${suffix}`, { Invalidation: invalidation(`I${suffix}`) }))),
    verify(items) {
      assert.deepEqual(items.map((item) => item.json.invalidationId), ['I1', 'I2']);
      assert.deepEqual(items.map((item) => item.json.distributionId), ['D1', 'D2']);
      assert.equal(items[1].json.createTime, date);
      assert.equal(items[1].json.status, 'Completed');
    },
  },
  {
    operation: 'listInvalidations',
    inputs: [{ label: 'invalidation-pages', distributionId: 'D1', returnAll: true }, { label: 'empty-invalidations', distributionId: 'D2' }],
    calls: [
      call('ListInvalidationsCommand', { DistributionId: 'D1', MaxItems: 1 }, response('invalidation-page-1', { InvalidationList: { Items: [invalidation('I1')], IsTruncated: true, NextMarker: 'page2' } })),
      call('ListInvalidationsCommand', { DistributionId: 'D1', MaxItems: 1, Marker: 'page2' }, response('invalidation-page-2', { InvalidationList: { Items: [invalidation('I2')], IsTruncated: false } })),
      call('ListInvalidationsCommand', { DistributionId: 'D2', MaxItems: 1 }, response('invalidation-empty', { InvalidationList: { Items: [], IsTruncated: false } })),
    ],
    verify(items) {
      assert.deepEqual(items[0].json.invalidations.map((item) => item.invalidationId), ['I1', 'I2']);
      assert.deepEqual(items[0].json.requestIds, ['invalidation-page-1', 'invalidation-page-2']);
      assert.equal(items[0].json.nextMarker, null);
      assert.equal(items[0].json.isTruncated, false);
      assert.deepEqual(items[1].json.invalidations, []);
      assert.equal(items[1].json.distributionId, 'D2');
    },
  },
];
function workflow(test, index) {
  const node = (name, type, typeVersion, parameters, extra = {}) => ({ id: name, name, type, typeVersion, position: [index * 200, 0], parameters, ...extra });
  return {
    id: `AwsSmoke${index + 1}`, name: `AWS packed smoke ${test.operation}`, active: false,
    settings: { executionOrder: 'v1' },
    nodes: [
      node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {}),
      node('Fixture', 'n8n-nodes-base.set', 3.4, { mode: 'raw', jsonOutput: JSON.stringify({ cases: test.inputs }), options: {} }),
      node('Inputs', 'n8n-nodes-base.splitOut', 1, { fieldToSplitOut: 'cases', include: 'noOtherFields', options: {} }),
      node('CloudFront', 'n8n-nodes-aws.awsCloudFront', 1, {
        operation: test.operation, distributionIdMode: 'manual',
        distributionId: '={{ $json.distributionId }}', invalidationId: '={{ $json.invalidationId }}',
        paths: '={{ $json.paths }}', callerReference: '={{ $json.callerReference }}',
        returnAll: '={{ $json.returnAll ?? false }}', marker: '={{ $json.marker ?? "" }}', pageSize: 1,
      }, { credentials: { awsCloudFrontApi: { id: 'AwsSmokeCredential', name: 'Smoke fake credentials' } }, continueOnFail: true }),
      node('Provenance', 'n8n-nodes-base.set', 3.4, {
        mode: 'raw', jsonOutput: '={{ { label: $("Inputs").item.json.label, result: $json } }}', options: {},
      }),
    ],
    connections: Object.fromEntries([
      ['Manual Trigger', 'Fixture'], ['Fixture', 'Inputs'], ['Inputs', 'CloudFront'], ['CloudFront', 'Provenance'],
    ].map(([from, to]) => [from, { main: [[{ node: to, type: 'main', index: 0 }]] }])),
  };
}
let success = false;
try {
  await Promise.all([home, userFolder, community].map((directory) => mkdir(directory, { recursive: true })));
  await Promise.all(['empty-npmrc', 'empty-aws-credentials', 'empty-aws-config'].map((file) => writeFile(path.join(root, file), '')));
  if (!process.env.N8N_SMOKE_RUNTIME) {
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ private: true }));
    run(npm, ['install', '--prefix', runtime, '--no-audit', '--no-fund', `n8n@${n8nVersion}`]);
  }
  const runtimePackage = path.join(runtime, 'node_modules', 'n8n');
  assert.equal(JSON.parse(await readFile(path.join(runtimePackage, 'package.json'), 'utf8')).version, n8nVersion,
    `N8N_SMOKE_RUNTIME must contain n8n@${n8nVersion}`);
  await writeFile(path.join(community, 'package.json'), JSON.stringify({ private: true }));
  // npm consumes the checked .tgz, never the repository directory or a source symlink.
  run(npm, ['install', '--prefix', community, '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund', tarball]);
  const installed = path.join(community, 'node_modules', artifact.name);
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.equal(await realpath(installed), installed);
  const installedManifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.version, artifact.version);
  assert.equal(installedManifest.name, artifact.name);
  console.log(`n8n ${n8nVersion}; Node ${process.versions.node}; runtime ${runtime}`);
  console.log(`Artifact ${artifact.path}; version ${artifact.version}; ${artifact.integrity}`);
  console.log(`Installed artifact community root ${community} (not a symlink)`);
  const preload = path.join(root, 'preload.cjs');
  await writeFile(preload, await readFile(new URL('./smoke/preload.cjs', import.meta.url)));
  const n8n = path.join(runtimePackage, 'bin', 'n8n');
  const cli = (args, extraEnv = {}) => run(process.execPath, ['--require', preload, n8n, ...args], {
    N8N_SMOKE_PACKAGE: installed,
    N8N_SMOKE_CREDENTIALS: JSON.stringify(fakeCredentials),
    ...extraEnv,
  });
  assert.equal(cli(['--version']).trim(), n8nVersion);
  const credentialsFile = path.join(root, 'credentials.json');
  const workflowsFile = path.join(root, 'workflows.json');
  await writeFile(credentialsFile, JSON.stringify([{ id: 'AwsSmokeCredential', name: 'Smoke fake credentials', type: 'awsCloudFrontApi', data: fakeCredentials }]));
  await writeFile(workflowsFile, JSON.stringify(cases.map(workflow)));
  cli(['import:credentials', `--input=${credentialsFile}`]);
  cli(['import:workflow', `--input=${workflowsFile}`]);
  const example = JSON.parse(await readFile(path.join(repository, 'examples/cloudfront-invalidation.json'), 'utf8'));
  assert.equal(example.active, false, 'The published example must remain inactive');
  assert.ok(example.nodes.every((node) => !node.credentials), 'The published example must not contain credential references');
  const exampleFile = path.join(root, 'example.json');
  const exportedExampleFile = path.join(root, 'example-export.json');
  await writeFile(exampleFile, JSON.stringify([{ ...example, id: 'AwsSmokeExample', active: false }]));
  cli(['import:workflow', `--input=${exampleFile}`]);
  cli(['export:workflow', '--id=AwsSmokeExample', `--output=${exportedExampleFile}`]);
  const [importedExample] = JSON.parse(await readFile(exportedExampleFile, 'utf8'));
  assert.equal(importedExample.id, 'AwsSmokeExample');
  assert.equal(importedExample.active, false);
  assert.deepEqual(importedExample.nodes, example.nodes);
  assert.deepEqual(importedExample.connections, example.connections);
  console.log('PASS sanitized examples/cloudfront-invalidation.json imported and exported inactive (never executed)');
  let totalItems = 0;
  let totalCommands = 0;
  for (const [index, test] of cases.entries()) {
    const planFile = path.join(root, `plan-${index}.json`);
    const callsFile = path.join(root, `calls-${index}.jsonl`);
    await writeFile(planFile, JSON.stringify(test.calls));
    const execution = parseExecution(cli(['execute', `--id=AwsSmoke${index + 1}`, '--rawOutput'], {
      N8N_SMOKE_PLAN: planFile, N8N_SMOKE_CALLS: callsFile,
    }));
    assert.equal(execution.data.resultData.error, undefined, `${test.operation} workflow failed`);
    const runData = execution.data.resultData.runData;
    const items = runData.CloudFront?.[0]?.data?.main?.[0];
    assert.ok(Array.isArray(items), `${test.operation} did not execute the installed CloudFront node`);
    assert.equal(items.length, test.inputs.length);
    for (const [itemIndex, item] of items.entries()) assert.deepEqual(item.pairedItem, { item: itemIndex });
    const provenance = runData.Provenance?.[0]?.data?.main?.[0];
    assert.deepEqual(provenance?.map((item) => item.json.label), test.inputs.map((item) => item.label),
      'Real n8n linked-item expressions must resolve the matching upstream input');
    assert.deepEqual(provenance.map((item) => item.json.result), items.map((item) => item.json));
    test.verify(items);
    const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(calls.every((entry) => !entry.failure), JSON.stringify(calls));
    assert.deepEqual(calls.map(({ command, input }) => ({ command, input })), test.calls.map(({ command, input }) => ({ command, input })));
    assert.ok(calls.every((entry) => entry.fakeCredentialsVerified === true));
    totalItems += items.length;
    totalCommands += calls.length;
    console.log(`PASS ${test.operation}: ${items.length} linked items; ${calls.length} deterministic SDK commands`);
  }
  console.log(`PASS real n8n CLI engine: five operations, ${totalItems} items, ${totalCommands} SDK commands; expressions, pairedItem, pagination, empty results, and continueOnFail`);
  success = true;
} finally {
  if (success && process.env.N8N_SMOKE_KEEP !== '1') {
    await rm(root, { recursive: true, force: true });
    console.log('Removed isolated smoke home, community install, credentials, workflows, database, and fixtures.');
  } else {
    console.error(`${success ? 'Smoke succeeded; explicit N8N_SMOKE_KEEP=1' : 'Smoke failed'}; isolated fake-only diagnostics retained at ${root}`);
  }
}
