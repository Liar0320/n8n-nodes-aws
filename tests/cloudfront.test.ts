import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { ICredentialTestFunctions, ICredentialsDecrypted, IExecuteFunctions, ILoadOptionsFunctions, INodeExecutionData } from 'n8n-workflow';
import { AwsCloudFront } from '../nodes/CloudFront/AwsCloudFront.node.ts';

type Parameters = Record<string, unknown>;
type Command = { input: Record<string, unknown>; constructor: { name: string } };
type Call = { name: string; input: Record<string, unknown> };
const credentials = { accessKeyId: 'ISOLATED_TEST_KEY', secretAccessKey: 'isolated-test-secret' };
const createdAt = new Date('2026-01-02T03:04:05.000Z');

function execution(rows: Parameters[], options: { continueOnFail?: boolean; credentials?: Parameters } = {}) {
	const parameterReads: Array<{ name: string; index: number }> = [];
	const credentialReads: Array<{ name: string; index?: number }> = [];
	const context = {
		getInputData: () => rows.map((_, index) => ({ json: { index } })),
		getNodeParameter(name: string, index: number, fallback?: unknown) {
			parameterReads.push({ name, index });
			const defaults: Parameters = { distributionIdMode: 'manual', returnAll: false, pageSize: 100, marker: '' };
			return rows[index][name] ?? defaults[name] ?? fallback;
		},
		async getCredentials(name: string, index?: number) {
			credentialReads.push({ name, index });
			return options.credentials ?? credentials;
		},
		continueOnFail: () => options.continueOnFail ?? false,
		getNode: () => ({ id: 'cloudfront-test', name: 'CloudFront test', type: 'n8n-nodes-aws.awsCloudFront', typeVersion: 1, position: [0, 0] }),
	};
	return { context: context as unknown as IExecuteFunctions, parameterReads, credentialReads };
}

async function execute(rows: Parameters[], options: { continueOnFail?: boolean; credentials?: Parameters } = {}) {
	const harness = execution(rows, options);
	const output = await new AwsCloudFront().execute.call(harness.context);
	assert.equal(output.length, 1, 'the node has one main output');
	return { ...harness, items: output[0] };
}

/** node:test isolates this file; each test additionally restores the real SDK method. */
async function withSdk(
	handler: (call: Call, index: number) => unknown | Promise<unknown>,
	run: (calls: Call[]) => Promise<void>,
) {
	const descriptor = Object.getOwnPropertyDescriptor(CloudFrontClient.prototype, 'send');
	const calls: Call[] = [];
	Object.defineProperty(CloudFrontClient.prototype, 'send', {
		configurable: true,
		writable: true,
		value: async function (this: CloudFrontClient, command: Command) {
			assert.ok(this instanceof CloudFrontClient);
			const call = { name: command.constructor.name, input: command.input };
			calls.push(call);
			const response = await handler(call, calls.length - 1);
			return { $metadata: {}, ...(response as object) };
		},
	});
	try { await run(calls); }
	finally {
		if (descriptor) Object.defineProperty(CloudFrontClient.prototype, 'send', descriptor);
		else Reflect.deleteProperty(CloudFrontClient.prototype, 'send');
	}
}

function paired(items: INodeExecutionData[], count: number) {
	assert.equal(items.length, count, 'one envelope is emitted per input, even for empty lists');
	items.forEach((item, index) => assert.deepEqual(item.pairedItem, { item: index }));
}

function distribution(id: string) {
	return {
		Id: id, ARN: `arn:aws:cloudfront::123456789012:distribution/${id}`,
		DomainName: `${id.toLowerCase()}.cloudfront.net`, Aliases: { Quantity: 1, Items: [`${id.toLowerCase()}.example.test`] },
		Enabled: true, Status: 'Deployed', Comment: 'test distribution', LastModifiedTime: createdAt,
	};
}

function invalidation(id: string, status = 'InProgress', paths = ['/article?version=2'], reference = 'event:revision:1') {
	return { Id: id, Status: status, CreateTime: createdAt,
		InvalidationBatch: { CallerReference: reference, Paths: { Quantity: paths.length, Items: paths } } };
}

function awsError(name: string, status: number) {
	return Object.assign(new Error('DO_NOT_EXPOSE isolated-test-secret Authorization: signed-material'), {
		name, $metadata: { httpStatusCode: status, requestId: `request-${name}` },
		request: { headers: { authorization: 'signed-material' } },
	});
}

const create = (extra: Parameters = {}): Parameters => ({
	operation: 'createInvalidation', distributionId: 'DIST1', paths: '/article', callerReference: 'event:revision:1', ...extra,
});

test('empty input performs no AWS or credential work', async () => {
	await withSdk(() => assert.fail('no request is allowed'), async (calls) => {
		const result = await execute([]);
		assert.deepEqual(result.items, []);
		assert.deepEqual(result.credentialReads, []);
		assert.equal(calls.length, 0);
	});
});

test('List Distributions single page retains its continuation marker and stable summaries', async () => {
	await withSdk((call) => {
		assert.equal(call.name, 'ListDistributionsCommand');
		assert.deepEqual(call.input, { Marker: 'start-here', MaxItems: 2 });
		return { DistributionList: { Items: [distribution('DIST1')], IsTruncated: true, NextMarker: 'next-page' }, $metadata: { requestId: 'request-list' } };
	}, async (calls) => {
		const { items } = await execute([{ operation: 'listDistributions', marker: 'start-here', pageSize: 2 }]);
		paired(items, 1);
		assert.deepEqual(items[0].json, {
			distributions: [{ distributionId: 'DIST1', arn: 'arn:aws:cloudfront::123456789012:distribution/DIST1',
				domainName: 'dist1.cloudfront.net', aliases: ['dist1.example.test'], enabled: true, status: 'Deployed',
				comment: 'test distribution', lastModifiedTime: createdAt.toISOString() }],
			nextMarker: 'next-page', isTruncated: true, requestIds: ['request-list'],
		});
		assert.equal(calls.length, 1);
	});
});

test('List Distributions return-all follows opaque markers through an empty final page exactly once', async () => {
	await withSdk((call, index) => {
		assert.equal(call.name, 'ListDistributionsCommand');
		assert.equal(call.input.Marker, [undefined, 'opaque/+==', 'last'][index]);
		assert.equal(call.input.MaxItems, 1);
		return { DistributionList: { Items: index < 2 ? [distribution(`DIST${index + 1}`)] : undefined,
			IsTruncated: index < 2, ...(index < 2 ? { NextMarker: ['opaque/+==', 'last'][index] } : {}) },
			$metadata: { requestId: `page-${index}` } };
	}, async (calls) => {
		const { items } = await execute([{ operation: 'listDistributions', returnAll: true, pageSize: 1 }]);
		paired(items, 1);
		assert.deepEqual((items[0].json.distributions as Parameters[]).map((item) => item.distributionId), ['DIST1', 'DIST2']);
		assert.deepEqual(items[0].json.requestIds, ['page-0', 'page-1', 'page-2']);
		assert.equal(items[0].json.nextMarker, null);
		assert.equal(items[0].json.isTruncated, false);
		assert.equal(calls.length, 3);
	});
});

for (const operation of ['listDistributions', 'listInvalidations']) {
	test(`${operation} preserves one empty envelope per input`, async () => {
		await withSdk(() => operation === 'listDistributions'
			? { DistributionList: { Quantity: 0, IsTruncated: false } }
			: { InvalidationList: { Quantity: 0, IsTruncated: false } }, async (calls) => {
			const { items } = await execute([{ operation, distributionId: 'DIST1' }, { operation, distributionId: 'DIST2' }]);
			paired(items, 2);
			for (const item of items) {
				assert.deepEqual(item.json[operation === 'listDistributions' ? 'distributions' : 'invalidations'], []);
				assert.equal(item.json.nextMarker, null);
				assert.equal(item.json.isTruncated, false);
			}
			assert.equal(calls.length, 2);
		});
	});
}

test('List Invalidations evaluates each input independently and exhausts only that distribution', async () => {
	await withSdk((call) => {
		assert.equal(call.name, 'ListInvalidationsCommand');
		const id = call.input.DistributionId;
		assert.equal(call.input.MaxItems, id === 'DIST1' ? 1 : 2);
		const more = id === 'DIST1' && call.input.Marker === 'resume';
		return { InvalidationList: { Items: [{ Id: more ? 'INV1' : 'INV2', Status: more ? 'InProgress' : 'Completed', CreateTime: createdAt }],
			IsTruncated: more, ...(more ? { NextMarker: 'remaining' } : {}) } };
	}, async (calls) => {
		const { items, parameterReads } = await execute([
			{ operation: 'listInvalidations', distributionId: 'DIST1', returnAll: true, marker: 'resume', pageSize: 1 },
			{ operation: 'listInvalidations', distributionIdMode: 'list', distributionIdList: 'DIST2', returnAll: true, pageSize: 2 },
		]);
		paired(items, 2);
		assert.deepEqual(calls.map((call) => [call.input.DistributionId, call.input.Marker]), [['DIST1', 'resume'], ['DIST1', 'remaining'], ['DIST2', undefined]]);
		assert.deepEqual((items[0].json.invalidations as Parameters[]).map((item) => item.invalidationId), ['INV1', 'INV2']);
		assert.equal(items[1].json.distributionId, 'DIST2');
		assert.ok(parameterReads.some((read) => read.name === 'distributionIdList' && read.index === 1));
	});
});

test('Get Distribution uses manual IDs without discovery and does not confuse deployment with invalidation state', async () => {
	await withSdk((call) => {
		assert.equal(call.name, 'GetDistributionCommand');
		const id = call.input.Id as string;
		return { Distribution: { ...distribution(id), InProgressInvalidationBatches: 3,
			DistributionConfig: { Enabled: false, Comment: 'details', Aliases: { Items: ['details.example.test'], Quantity: 1 },
				Origins: { Items: [{ Id: 'origin', DomainName: 'origin.example.test', OriginPath: '/content' }], Quantity: 1 },
				DefaultRootObject: 'index.html', HttpVersion: 'http2', IsIPV6Enabled: true, PriceClass: 'PriceClass_100' } },
			ETag: 'etag-1', $metadata: { requestId: `request-${id}` } };
	}, async (calls) => {
		const { items } = await execute([{ operation: 'getDistribution', distributionId: 'DIST1' }, { operation: 'getDistribution', distributionId: 'DIST2' }]);
		paired(items, 2);
		assert.deepEqual(calls.map((call) => call.input), [{ Id: 'DIST1' }, { Id: 'DIST2' }]);
		items.forEach((item, index) => {
			assert.equal(item.json.distributionId, `DIST${index + 1}`);
			assert.equal(item.json.status, 'Deployed');
			assert.equal(item.json.inProgressInvalidationBatches, 3);
			assert.equal(item.json.enabled, false);
			assert.deepEqual(item.json.aliases, ['details.example.test']);
			assert.deepEqual(item.json.origins, [{ id: 'origin', domainName: 'origin.example.test', originPath: '/content' }]);
			assert.equal(item.json.etag, 'etag-1');
			assert.equal(item.json.requestId, `request-DIST${index + 1}`);
			assert.equal('nextMarker' in item.json, false);
		});
	});
});

test('Get Invalidation reads InProgress and Completed verbatim, without polling', async () => {
	await withSdk((call, index) => {
		assert.equal(call.name, 'GetInvalidationCommand');
		assert.deepEqual(call.input, { DistributionId: `DIST${index + 1}`, Id: `INV${index + 1}` });
		return { Invalidation: invalidation(`INV${index + 1}`, index === 0 ? 'InProgress' : 'Completed'), $metadata: { requestId: `get-${index}` } };
	}, async (calls) => {
		const { items } = await execute([0, 1].map((index) => ({ operation: 'getInvalidation', distributionId: `DIST${index + 1}`, invalidationId: `INV${index + 1}` })));
		paired(items, 2);
		assert.deepEqual(items.map((item) => item.json.status), ['InProgress', 'Completed']);
		items.forEach((item) => {
			assert.deepEqual(item.json.paths, ['/article?version=2']);
			assert.equal(item.json.callerReference, 'event:revision:1');
			assert.equal(item.json.createTime, createdAt.toISOString());
		});
		assert.equal(calls.length, 2);
	});
});

test('Create Invalidation preserves case, encoding, query and slash semantics while removing only exact duplicates and blank lines', async () => {
	const paths = ['/', '//asset', '/a//b', '/Article', '/article', '/article/', '/article?x=1&y=2', '/article?y=2&x=1', '/a%2Fb', '/a%2fb', '/a/b', '/literal*name', '/approved/*'];
	await withSdk((call) => {
		assert.equal(call.name, 'CreateInvalidationCommand');
		assert.deepEqual(call.input, { DistributionId: 'DIST1', InvalidationBatch: {
			CallerReference: 'event:revision:1', Paths: { Quantity: paths.length, Items: paths },
		} });
		return { Invalidation: invalidation('INV1', 'InProgress', paths), $metadata: { requestId: 'create-1' } };
	}, async (calls) => {
		const { items } = await execute([create({ paths: `\r\n \t\r\n${paths.join('\r\n')}\r\n/article\n/a%2Fb\n` })]);
		paired(items, 1);
		assert.deepEqual(items[0].json, { distributionId: 'DIST1', invalidationId: 'INV1', status: 'InProgress',
			createTime: createdAt.toISOString(), callerReference: 'event:revision:1', paths, requestId: 'create-1' });
		assert.equal(calls.length, 1);
	});
});

test('the 4,000-character path boundary includes its query string', async () => {
	const path = `/${'a'.repeat(3994)}?v=12`;
	assert.equal(path.length, 4000);
	await withSdk((call) => {
		assert.deepEqual(call.input.InvalidationBatch, { CallerReference: 'event:revision:1', Paths: { Quantity: 1, Items: [path] } });
		return { Invalidation: invalidation('INV1', 'InProgress', [path]) };
	}, async (calls) => {
		await execute([create({ paths: path })]);
		await assert.rejects(execute([create({ paths: `${path}3` })]), /4,000|4000/);
		assert.equal(calls.length, 1, 'an overlong path cannot reach AWS');
	});
});

for (const [label, paths] of Object.entries({
	empty: '', blank: '\n \t\r\n', url: 'https://example.test/article', relative: 'article',
	leadingSpace: ' /article', trailingSpace: '/article ', rawSpace: '/an article', rawUnicode: '/café', rawFragment: '/article#section',
	badEscape: '/article%2', invalidEscape: '/article%GG', tilde: '/~article', encodedTilde: '/%7earticle', unsafe: '/a\\b',
})) {
	test(`invalid ${label} paths fail locally without falling back to /*`, async () => {
		await withSdk(() => assert.fail('invalid paths must not mutate AWS'), async (calls) => {
			await assert.rejects(execute([create({ paths })]));
			assert.equal(calls.length, 0);
		});
	});
}

test('all create inputs are prevalidated before the first mutation, including later expressions', async () => {
	await withSdk(() => assert.fail('no earlier valid batch may be submitted'), async (calls) => {
		await assert.rejects(execute([create(), create({ distributionId: 'DIST2', paths: 'https://example.test/not-a-path' })]));
		assert.equal(calls.length, 0);
	});
});

test('multiple create items stay separate and reuse the supplied caller references unchanged', async () => {
	await withSdk((call, index) => {
		const batch = call.input.InvalidationBatch as { CallerReference: string; Paths: { Items: string[] } };
		assert.equal(call.input.DistributionId, `DIST${index + 1}`);
		assert.equal(batch.CallerReference, `event:${index + 1}`);
		assert.deepEqual(batch.Paths.Items, [`/article/${index + 1}`]);
		return { Invalidation: invalidation(`INV${index + 1}`, 'InProgress', batch.Paths.Items, batch.CallerReference) };
	}, async (calls) => {
		const { items } = await execute([1, 2].map((index) => create({ distributionId: `DIST${index}`, paths: `/article/${index}`, callerReference: `event:${index}` })));
		paired(items, 2);
		assert.deepEqual(items.map((item) => item.json.distributionId), ['DIST1', 'DIST2']);
		assert.equal(calls.length, 2);
	});
});

test('same-reference same-batch retries preserve AWS idempotency and changed payload conflicts remain visible', async () => {
	const batches = new Map<string, { paths: string[]; id: string }>();
	await withSdk((call) => {
		assert.equal(call.name, 'CreateInvalidationCommand');
		const batch = call.input.InvalidationBatch as { CallerReference: string; Paths: { Items: string[] } };
		const key = `${call.input.DistributionId}:${batch.CallerReference}`;
		const previous = batches.get(key);
		if (previous && JSON.stringify(previous.paths) !== JSON.stringify(batch.Paths.Items)) throw awsError('InvalidationBatchAlreadyExists', 400);
		const current = previous ?? { paths: batch.Paths.Items, id: `INV${batches.size + 1}` };
		batches.set(key, current);
		return { Invalidation: invalidation(current.id, 'InProgress', current.paths, batch.CallerReference) };
	}, async (calls) => {
		const first = await execute([create()]);
		const retried = await execute([create()]);
		assert.equal(first.items[0].json.invalidationId, retried.items[0].json.invalidationId);
		assert.equal(batches.size, 1);
		await assert.rejects(execute([create({ paths: '/changed' })]), /InvalidationBatchAlreadyExists/);
		assert.equal(calls.length, 3, 'the node must not silently change the caller reference or suppress AWS conflicts');
		assert.equal(batches.size, 1);
	});
});

for (const operation of ['listDistributions', 'listInvalidations']) {
	for (const kind of ['missing', 'repeated', 'cycle']) {
		test(`${operation} rejects ${kind} continuation markers instead of looping or returning partial success`, async () => {
			await withSdk((_, index) => {
				const next = kind === 'missing' ? undefined : kind === 'repeated' ? 'start' : index === 0 ? 'second' : 'start';
				const page = { Items: [], IsTruncated: true, ...(next ? { NextMarker: next } : {}) };
				return operation === 'listDistributions' ? { DistributionList: page } : { InvalidationList: page };
			}, async (calls) => {
				await assert.rejects(execute([{ operation, distributionId: 'DIST1', marker: 'start', returnAll: true }]), /InvalidPaginationResponse/);
				assert.equal(calls.length, kind === 'cycle' ? 2 : 1);
			});
		});
	}
}

test('List Invalidations single-page mode does not fetch the advertised next page', async () => {
	await withSdk((call) => {
		assert.deepEqual(call.input, { DistributionId: 'DIST1', Marker: undefined, MaxItems: 100 });
		return { InvalidationList: { Items: [{ Id: 'INV1', Status: 'InProgress', CreateTime: createdAt }], IsTruncated: true, NextMarker: 'next' } };
	}, async (calls) => {
		const { items } = await execute([{ operation: 'listInvalidations', distributionId: 'DIST1' }]);
		assert.equal(items[0].json.nextMarker, 'next');
		assert.equal(items[0].json.isTruncated, true);
		assert.equal(calls.length, 1);
	});
});

for (const [name, extra] of Object.entries({
	distribution: { distributionId: 'https://example.test/DIST1' },
	blankReference: { callerReference: ' \t' },
	emptyReference: { callerReference: '' },
})) {
	test(`invalid later ${name} prevents every create mutation`, async () => {
		await withSdk(() => assert.fail('prevalidation must finish before mutation'), async (calls) => {
			await assert.rejects(execute([create(), create(extra)]), /ValidationError/);
			assert.equal(calls.length, 0);
		});
	});
}

for (const extra of [
	{ operation: 'getDistribution', distributionId: '' },
	{ operation: 'getDistribution', distributionId: 'DIST 1' },
	{ operation: 'getInvalidation', distributionId: 'DIST1', invalidationId: 'INV/1' },
	{ operation: 'getInvalidation', distributionId: 'DIST1', invalidationId: '' },
	...[0, 101, 1.5, '10'].map((pageSize) => ({ operation: 'listDistributions', pageSize })),
]) {
	test(`malformed local inputs are rejected before SDK requests: ${JSON.stringify(extra)}`, async () => {
		await withSdk(() => assert.fail('invalid inputs must not reach AWS'), async (calls) => {
			await assert.rejects(execute([extra]), /ValidationError/);
			assert.equal(calls.length, 0);
		});
	});
}

test('continue-on-fail retains local failure positions while submitting only valid prevalidated batches', async () => {
	await withSdk((call) => {
		assert.equal(call.input.DistributionId, 'DIST2');
		return { Invalidation: invalidation('INV2') };
	}, async (calls) => {
		const { items } = await execute([create({ paths: '' }), create({ distributionId: 'DIST2' }), create({ callerReference: '' })], { continueOnFail: true });
		paired(items, 3);
		assert.equal((items[0].json.error as Parameters).code, 'ValidationError');
		assert.equal(items[1].json.invalidationId, 'INV2');
		assert.equal((items[2].json.error as Parameters).code, 'ValidationError');
		assert.equal(calls.length, 1);
	});
});

for (const [operation, code, status] of [
	['listDistributions', 'AccessDenied', 403],
	['getDistribution', 'NoSuchDistribution', 404],
	['createInvalidation', 'TooManyInvalidationsInProgress', 400],
	['getInvalidation', 'NoSuchInvalidation', 404],
	['listInvalidations', 'Throttling', 429],
] as const) {
	test(`${operation} fails honestly and sanitizes ${code} in both error modes`, async () => {
		await withSdk(() => { throw awsError(code, status); }, async (calls) => {
			const row = { ...create(), operation, invalidationId: 'INV1' };
			await assert.rejects(execute([row]), (error: unknown) => {
				assert.match(String(error), new RegExp(code));
				assert.doesNotMatch(String(error), /DO_NOT_EXPOSE|isolated-test-secret|Authorization|signed-material/);
				return true;
			});
			const { items } = await execute([row], { continueOnFail: true });
			paired(items, 1);
			assert.deepEqual(Object.keys(items[0].json), ['error']);
			const error = items[0].json.error as Parameters;
			assert.equal(error.code, code);
			assert.equal(error.httpStatus, status);
			assert.equal(error.requestId, `request-${code}`);
			assert.doesNotMatch(JSON.stringify(items), /DO_NOT_EXPOSE|isolated-test-secret|Authorization|signed-material/);
			assert.equal(calls.length, 2);
		});
	});
}

test('continue-on-fail processes items after an AWS failure and preserves successful earlier mutations', async () => {
	await withSdk((call) => {
		if (call.input.DistributionId === 'DIST2') throw awsError('AccessDenied', 403);
		return { Invalidation: invalidation(`INV${String(call.input.DistributionId).slice(-1)}`) };
	}, async (calls) => {
		const rows = [1, 2, 3].map((index) => create({ distributionId: `DIST${index}` }));
		const { items } = await execute(rows, { continueOnFail: true });
		paired(items, 3);
		assert.equal(items[0].json.invalidationId, 'INV1');
		assert.equal((items[1].json.error as Parameters).code, 'AccessDenied');
		assert.equal(items[2].json.invalidationId, 'INV3');
		assert.deepEqual(calls.map((call) => call.input.DistributionId), ['DIST1', 'DIST2', 'DIST3']);
	});
});

test('stop-on-error cannot roll back an earlier AWS submission and never submits later items', async () => {
	await withSdk((call) => {
		if (call.input.DistributionId === 'DIST2') throw awsError('AccessDenied', 403);
		return { Invalidation: invalidation('INV1') };
	}, async (calls) => {
		await assert.rejects(execute([1, 2, 3].map((index) => create({ distributionId: `DIST${index}` }))), /AccessDenied/);
		assert.deepEqual(calls.map((call) => call.input.DistributionId), ['DIST1', 'DIST2']);
	});
});

test('failed later pagination is an error, not a successful partial result', async () => {
	await withSdk((_, index) => {
		if (index === 1) throw awsError('Throttling', 429);
		return { DistributionList: { Items: [distribution('DIST1')], IsTruncated: true, NextMarker: 'next' } };
	}, async () => {
		const { items } = await execute([{ operation: 'listDistributions', returnAll: true }], { continueOnFail: true });
		assert.equal((items[0].json.error as Parameters).code, 'Throttling');
		assert.equal('distributions' in items[0].json, false);
	});
});

for (const operation of ['listDistributions', 'getDistribution', 'createInvalidation', 'getInvalidation', 'listInvalidations']) {
	test(`${operation} rejects a successful SDK response missing the requested result`, async () => {
		await withSdk(() => ({}), async () => {
			const { items } = await execute([{ ...create(), operation, invalidationId: 'INV1' }], { continueOnFail: true });
			assert.equal((items[0].json.error as Parameters).code, 'InvalidAwsResponse');
		});
	});
}

test('empty credentials never use an ambient AWS credential chain or send an unsigned request', async () => {
	await withSdk(() => assert.fail('empty credentials cannot reach send'), async (calls) => {
		await assert.rejects(execute([{ operation: 'getDistribution', distributionId: 'DIST1' }], { credentials: {} }));
		const { items } = await execute([{ operation: 'getDistribution', distributionId: 'DIST1' }], { credentials: {}, continueOnFail: true });
		assert.ok(items[0].json.error);
		assert.equal(calls.length, 0);
	});
});

function loadOptionsContext() {
	const harness = execution([]);
	return harness.context as unknown as ILoadOptionsFunctions;
}

const credentialTest = (data?: Parameters) => new AwsCloudFront().methods.credentialTest.awsCloudFrontApiTest.call(
	{} as ICredentialTestFunctions,
	{ id: 'test-credential', name: 'Isolated test credentials', type: 'awsCloudFrontApi', ...(data === undefined ? {} : { data }) } as ICredentialsDecrypted,
);

test('distribution loadOptions follows all pages, including empty pages, and returns selectable IDs', async () => {
	await withSdk((call, index) => {
		assert.equal(call.name, 'ListDistributionsCommand');
		assert.deepEqual(call.input, { Marker: [undefined, 'empty', 'last'][index], MaxItems: 100 });
		return { DistributionList: { Items: index === 1 ? [] : [distribution(`DIST${index + 1}`)], IsTruncated: index < 2,
			...(index < 2 ? { NextMarker: ['empty', 'last'][index] } : {}) } };
	}, async (calls) => {
		const choices = await new AwsCloudFront().methods.loadOptions.getDistributions.call(loadOptionsContext());
		assert.deepEqual(choices, [
			{ name: 'dist1.cloudfront.net (DIST1)', value: 'DIST1', description: 'dist1.example.test' },
			{ name: 'dist3.cloudfront.net (DIST3)', value: 'DIST3', description: 'dist3.example.test' },
		]);
		assert.equal(calls.length, 3);
	});
});

test('distribution loadOptions empty and denied results are not fake choices', async () => {
	await withSdk(() => ({ DistributionList: { IsTruncated: false, Quantity: 0 } }), async () => {
		assert.deepEqual(await new AwsCloudFront().methods.loadOptions.getDistributions.call(loadOptionsContext()), []);
	});
	await withSdk(() => { throw awsError('AccessDenied', 403); }, async () => {
		await assert.rejects(new AwsCloudFront().methods.loadOptions.getDistributions.call(loadOptionsContext()), (error: unknown) => {
			assert.match(String(error), /AccessDenied/);
			assert.doesNotMatch(String(error), /DO_NOT_EXPOSE|isolated-test-secret|signed-material/);
			return true;
		});
	});
});

test('distribution loadOptions refuses non-advancing pagination', async () => {
	await withSdk(() => ({ DistributionList: { Items: [], IsTruncated: true, NextMarker: 'same' } }), async (calls) => {
		await assert.rejects(new AwsCloudFront().methods.loadOptions.getDistributions.call(loadOptionsContext()), /InvalidPaginationResponse/);
		assert.equal(calls.length, 2);
	});
});

test('credential testing uses one read-only list request unless a known distribution is supplied', async () => {
	await withSdk(() => ({}), async (calls) => {
		const account = await credentialTest(credentials);
		const targeted = await credentialTest({ ...credentials, testDistributionId: 'DIST1' });
		assert.equal(account.status, 'OK');
		assert.equal(targeted.status, 'OK');
		assert.match(account.message, /ListDistributions/);
		assert.match(targeted.message, /GetDistribution/);
		assert.deepEqual(calls, [
			{ name: 'ListDistributionsCommand', input: { MaxItems: 1 } },
			{ name: 'GetDistributionCommand', input: { Id: 'DIST1' } },
		]);
	});
});

test('credential testing rejects missing data, empty keys and malformed test IDs without network calls', async () => {
	await withSdk(() => assert.fail('invalid credentials cannot reach AWS'), async (calls) => {
		for (const data of [undefined, {}, { accessKeyId: '', secretAccessKey: '' }, { ...credentials, testDistributionId: 'https://example.test/DIST1' }]) {
			const result = await credentialTest(data);
			assert.equal(result.status, 'Error');
			assert.doesNotMatch(result.message, /isolated-test-secret|https:\/\/example/);
		}
		assert.equal(calls.length, 0);
	});
});

test('credential testing exposes safe permission diagnostics, not raw AWS errors or signed requests', async () => {
	await withSdk(() => { throw awsError('AccessDenied', 403); }, async () => {
		const result = await credentialTest(credentials);
		assert.equal(result.status, 'Error');
		assert.match(result.message, /AccessDenied/);
		assert.match(result.message, /403/);
		assert.match(result.message, /request-AccessDenied/);
		assert.doesNotMatch(result.message, /DO_NOT_EXPOSE|isolated-test-secret|Authorization|signed-material/);
	});
});

test('per-item credentials are resolved with the corresponding input index', async () => {
	await withSdk((call) => ({ Distribution: distribution(call.input.Id as string) }), async () => {
		const { credentialReads, items } = await execute([
			{ operation: 'getDistribution', distributionId: 'DIST1' },
			{ operation: 'getDistribution', distributionId: 'DIST2' },
		]);
		paired(items, 2);
		assert.deepEqual(credentialReads, [
			{ name: 'awsCloudFrontApi', index: 0 },
			{ name: 'awsCloudFrontApi', index: 1 },
		]);
	});
});

test('an explicit later Get observes completion for the same invalidation without hidden polling', async () => {
	await withSdk((call, index) => {
		assert.equal(call.name, 'GetInvalidationCommand');
		assert.deepEqual(call.input, { DistributionId: 'DIST1', Id: 'INV1' });
		return { Invalidation: invalidation('INV1', index === 0 ? 'InProgress' : 'Completed') };
	}, async (calls) => {
		const row = { operation: 'getInvalidation', distributionId: 'DIST1', invalidationId: 'INV1' };
		const submitted = await execute([row]);
		assert.equal(submitted.items[0].json.status, 'InProgress');
		assert.equal(calls.length, 1);
		const completed = await execute([row]);
		assert.equal(completed.items[0].json.status, 'Completed');
		assert.equal(calls.length, 2);
	});
});

test('idempotently reused Completed create responses are not demoted or resubmitted', async () => {
	await withSdk(() => ({ Invalidation: invalidation('INV1', 'Completed', ['/article']) }), async (calls) => {
		const { items } = await execute([create()]);
		assert.equal(items[0].json.status, 'Completed');
		assert.equal(calls.length, 1);
	});
});
