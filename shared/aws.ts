import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

/** Fixed commercial CloudFront endpoint: no user-controlled host or signing region. */
export function createCloudFrontClient(credentials: ICredentialDataDecryptedObject): CloudFrontClient {
	const accessKeyId = credentials.accessKeyId;
	const secretAccessKey = credentials.secretAccessKey;
	const sessionToken = credentials.sessionToken;
	if (typeof accessKeyId !== 'string' || !accessKeyId ||
		typeof secretAccessKey !== 'string' || !secretAccessKey ||
		(sessionToken !== undefined && typeof sessionToken !== 'string')) {
		throw new Error('AWS credentials are incomplete');
	}
	return new CloudFrontClient({
		region: 'us-east-1',
		endpoint: 'https://cloudfront.amazonaws.com',
		credentials: {
			accessKeyId,
			secretAccessKey,
			...(sessionToken ? { sessionToken } : {}),
		},
		maxAttempts: 3,
		requestHandler: new NodeHttpHandler({ connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true }),
	});
}

export interface SafeAwsError {
	message: string;
	code: string;
	httpStatus?: number;
	requestId?: string;
}

/** Never forward SDK messages, causes, request objects, headers, or arbitrary properties. */
export function safeAwsError(error: unknown): SafeAwsError {
	const value = (typeof error === 'object' && error !== null ? error : {}) as {
		name?: unknown;
		$metadata?: { httpStatusCode?: unknown; requestId?: unknown };
	};
	const code = typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(value.name)
		? value.name : 'AwsRequestError';
	const status = value.$metadata?.httpStatusCode;
	const requestId = value.$metadata?.requestId;
	const guidance = code === 'AccessDenied' || code === 'AccessDeniedException'
		? 'Check IAM permissions for this operation and distribution.'
		: code === 'InvalidClientTokenId' || code === 'ExpiredToken' || code === 'SignatureDoesNotMatch'
			? 'Check the access key, secret, session token, and system clock.'
			: 'Check AWS service state and the operation inputs; retry only when appropriate.';
	return {
		message: `CloudFront request failed (${code}). ${guidance}`,
		code,
		...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
			? { httpStatus: status } : {}),
		...(typeof requestId === 'string' && /^[A-Za-z0-9_+=/.-]{1,200}$/.test(requestId)
			? { requestId } : {}),
	};
}
