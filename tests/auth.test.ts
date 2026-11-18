import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { createCloudFrontClient, safeAwsError } from '../shared/aws';

for (const temporary of [false, true]) {
	test(`official SDK signs ${temporary ? 'session' : 'long-lived'} credentials and reads CloudFront XML`, async () => {
		const client = createCloudFrontClient({
			accessKeyId: 'ISOLATED_TEST_KEY', secretAccessKey: 'isolated-test-secret',
			...(temporary ? { sessionToken: 'isolated-test-token' } : {}),
		});
		let signed = false;
		client.config.requestHandler.handle = async (request) => {
			assert.equal(request.hostname, 'cloudfront.amazonaws.com');
			assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 /);
			assert.match(request.headers.authorization, /us-east-1\/cloudfront\/aws4_request/);
			assert.equal(request.headers['x-amz-security-token'], temporary ? 'isolated-test-token' : undefined);
			assert.equal(request.query?.MaxItems, '1');
			signed = true;
			return { response: { statusCode: 200, headers: { 'x-amzn-requestid': 'request-test-1' },
				body: Readable.from(['<DistributionList xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Marker></Marker><MaxItems>1</MaxItems><IsTruncated>false</IsTruncated><Quantity>0</Quantity></DistributionList>']) } };
		};
		try {
			const result = await client.send(new ListDistributionsCommand({ MaxItems: 1 }));
			assert.equal(signed, true);
			assert.equal(result.DistributionList?.IsTruncated, false);
			assert.equal(result.DistributionList?.Quantity, 0);
		} finally { client.destroy(); }
	});
}

test('SDK XML access denial retains only safe diagnostic fields', async () => {
	const client = createCloudFrontClient({ accessKeyId: 'ISOLATED_TEST_KEY', secretAccessKey: 'isolated-test-secret' });
	client.config.requestHandler.handle = async () => ({ response: {
		statusCode: 403, headers: { 'x-amzn-requestid': 'request-denied-1' },
		body: Readable.from(['<ErrorResponse><Error><Code>AccessDenied</Code><Message>private-request-context isolated-test-secret</Message></Error><RequestId>request-denied-1</RequestId></ErrorResponse>']),
	} });
	try {
		await assert.rejects(client.send(new ListDistributionsCommand({ MaxItems: 1 })), (error: unknown) => {
			const safe = safeAwsError(error);
			assert.equal(safe.code, 'AccessDenied');
			assert.equal(safe.httpStatus, 403);
			assert.equal(safe.requestId, 'request-denied-1');
			assert.match(safe.message, /IAM/);
			assert.doesNotMatch(JSON.stringify(safe), /private-request|isolated-test-secret|authorization/i);
			return true;
		});
	} finally { client.destroy(); }
});

test('unsafe exception metadata and raw errors cannot escape the error boundary', () => {
	assert.deepEqual(safeAwsError({ name: 'secret with spaces', message: 'secret', $metadata: {
		requestId: 'secret\nAuthorization: material', httpStatusCode: '403',
	} }), { code: 'AwsRequestError', message: 'CloudFront request failed (AwsRequestError). Check AWS service state and the operation inputs; retry only when appropriate.' });
	assert.throws(() => createCloudFrontClient({ accessKeyId: '', secretAccessKey: '' }), /incomplete/);
});
