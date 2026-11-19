import {
	CreateInvalidationCommand,
	GetDistributionCommand,
	GetInvalidationCommand,
	ListDistributionsCommand,
	ListInvalidationsCommand,
	type CloudFrontClient,
} from '@aws-sdk/client-cloudfront';
import {
	NodeConnectionTypes,
	NodeOperationError,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeCredentialTestResult,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { createCloudFrontClient, safeAwsError, type SafeAwsError } from '../../shared/aws';
import {
	CloudFrontInputError,
	distributionDetails,
	distributionOutput,
	invalidationOutput,
	nextPageMarker,
	parseInvalidationPaths,
	validateCallerReference,
	validateId,
	validatePageSize,
} from './helpers';
import codex from './AwsCloudFront.node.json';
import { cloudFrontProperties } from './properties';

type Operation = 'listDistributions' | 'getDistribution' | 'createInvalidation' | 'getInvalidation' | 'listInvalidations';
type PreparedItem =
	| { operation: 'listDistributions'; returnAll: boolean; pageSize: number; marker?: string }
	| { operation: 'getDistribution'; distributionId: string }
	| { operation: 'createInvalidation'; distributionId: string; paths: string[]; callerReference: string }
	| { operation: 'getInvalidation'; distributionId: string; invalidationId: string }
	| { operation: 'listInvalidations'; distributionId: string; returnAll: boolean; pageSize: number; marker?: string };

function prepareItem(context: IExecuteFunctions, itemIndex: number): PreparedItem {
	const operation = context.getNodeParameter('operation', itemIndex) as Operation;
	if (!['listDistributions', 'getDistribution', 'createInvalidation', 'getInvalidation', 'listInvalidations'].includes(operation)) {
		throw new CloudFrontInputError('Unsupported CloudFront operation.');
	}
	let distributionId = '';
	if (operation !== 'listDistributions') {
		const mode = context.getNodeParameter('distributionIdMode', itemIndex, 'manual');
		if (mode !== 'manual' && mode !== 'list') {
			throw new CloudFrontInputError('Choose Enter ID or Choose From List for Distribution ID Source.');
		}
		distributionId = validateId(context.getNodeParameter(mode === 'list' ? 'distributionIdList' : 'distributionId', itemIndex), 'Distribution ID');
	}
	if (operation === 'createInvalidation') {
		return {
			operation,
			distributionId,
			paths: parseInvalidationPaths(context.getNodeParameter('paths', itemIndex)),
			callerReference: validateCallerReference(context.getNodeParameter('callerReference', itemIndex)),
		};
	}
	if (operation === 'getInvalidation') {
		return { operation, distributionId, invalidationId: validateId(context.getNodeParameter('invalidationId', itemIndex), 'Invalidation ID') };
	}
	if (operation === 'getDistribution') return { operation, distributionId };
	const returnAll = context.getNodeParameter('returnAll', itemIndex, false);
	if (typeof returnAll !== 'boolean') throw new CloudFrontInputError('Return All must be a boolean.');
	const marker = context.getNodeParameter('marker', itemIndex, '');
	if (typeof marker !== 'string') throw new CloudFrontInputError('Marker must be a string returned by an earlier list response.');
	return {
		operation,
		...(operation === 'listInvalidations' ? { distributionId } : {}),
		returnAll,
		pageSize: validatePageSize(context.getNodeParameter('pageSize', itemIndex, 100)),
		marker: marker === '' ? undefined : marker,
	} as PreparedItem;
}

async function executeItem(client: CloudFrontClient, item: PreparedItem): Promise<IDataObject> {
	switch (item.operation) {
		case 'getDistribution': {
			const response = await client.send(new GetDistributionCommand({ Id: item.distributionId }));
			if (!response.Distribution) throw new CloudFrontInputError('AWS returned no distribution in a successful response.', 'InvalidAwsResponse');
			return { ...distributionDetails(response.Distribution, response.ETag), requestId: response.$metadata.requestId ?? null };
		}
		case 'createInvalidation': {
			const response = await client.send(new CreateInvalidationCommand({
				DistributionId: item.distributionId,
				InvalidationBatch: {
					CallerReference: item.callerReference,
					Paths: { Quantity: item.paths.length, Items: item.paths },
				},
			}));
			if (!response.Invalidation) throw new CloudFrontInputError('AWS returned no invalidation in a successful response.', 'InvalidAwsResponse');
			return { ...invalidationOutput(item.distributionId, response.Invalidation), requestId: response.$metadata.requestId ?? null };
		}
		case 'getInvalidation': {
			const response = await client.send(new GetInvalidationCommand({ DistributionId: item.distributionId, Id: item.invalidationId }));
			if (!response.Invalidation) throw new CloudFrontInputError('AWS returned no invalidation in a successful response.', 'InvalidAwsResponse');
			return { ...invalidationOutput(item.distributionId, response.Invalidation), requestId: response.$metadata.requestId ?? null };
		}
		case 'listDistributions': {
			const distributions: IDataObject[] = [];
			const requestIds: string[] = [];
			let marker = item.marker;
			const seenMarkers = new Set<string>(marker ? [marker] : []);
			do {
				const response = await client.send(new ListDistributionsCommand({ Marker: marker, MaxItems: item.pageSize }));
				const page = response.DistributionList;
				if (!page) throw new CloudFrontInputError('AWS returned no distribution list in a successful response.', 'InvalidAwsResponse');
				for (const distribution of page.Items ?? []) distributions.push(distributionOutput(distribution));
				if (response.$metadata.requestId) requestIds.push(response.$metadata.requestId);
				marker = nextPageMarker(page.IsTruncated, page.NextMarker, seenMarkers);
			} while (item.returnAll && marker);
			return { distributions, nextMarker: marker ?? null, isTruncated: marker !== undefined, requestIds };
		}
		case 'listInvalidations': {
			const invalidations: IDataObject[] = [];
			const requestIds: string[] = [];
			let marker = item.marker;
			const seenMarkers = new Set<string>(marker ? [marker] : []);
			do {
				const response = await client.send(new ListInvalidationsCommand({ DistributionId: item.distributionId, Marker: marker, MaxItems: item.pageSize }));
				const page = response.InvalidationList;
				if (!page) throw new CloudFrontInputError('AWS returned no invalidation list in a successful response.', 'InvalidAwsResponse');
				for (const invalidation of page.Items ?? []) invalidations.push(invalidationOutput(item.distributionId, invalidation));
				if (response.$metadata.requestId) requestIds.push(response.$metadata.requestId);
				marker = nextPageMarker(page.IsTruncated, page.NextMarker, seenMarkers);
			} while (item.returnAll && marker);
			return { distributionId: item.distributionId, invalidations, nextMarker: marker ?? null, isTruncated: marker !== undefined, requestIds };
		}
	}
}

function sanitizedError(error: unknown): SafeAwsError {
	if (error instanceof CloudFrontInputError) return { message: error.message, code: error.code };
	return safeAwsError(error);
}

export class AwsCloudFront implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AWS CloudFront',
		name: 'awsCloudFront',
		icon: 'file:cloudfront.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Inspect AWS CloudFront distributions and manage explicit invalidation batches',
		defaults: { name: 'AWS CloudFront' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		codex,
		credentials: [{ name: 'awsCloudFrontApi', required: true, testedBy: 'awsCloudFrontApiTest' }],
		properties: cloudFrontProperties,
	};

	methods = {
		loadOptions: {
			async getDistributions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const client = createCloudFrontClient(await this.getCredentials('awsCloudFrontApi'));
				try {
					const options: INodePropertyOptions[] = [];
					let marker: string | undefined;
					const seenMarkers = new Set<string>();
					do {
						const response = await client.send(new ListDistributionsCommand({ Marker: marker, MaxItems: 100 }));
						const page = response.DistributionList;
						if (!page) throw new CloudFrontInputError('AWS returned no distribution list in a successful response.', 'InvalidAwsResponse');
						for (const distribution of page.Items ?? []) {
							if (!distribution.Id || !distribution.DomainName) {
								throw new CloudFrontInputError('AWS returned a distribution without an ID or domain name.', 'InvalidAwsResponse');
							}
							options.push({ name: `${distribution.DomainName} (${distribution.Id})`, value: distribution.Id, description: (distribution.Aliases?.Items ?? []).join(', ') });
						}
						marker = nextPageMarker(page.IsTruncated, page.NextMarker, seenMarkers);
					} while (marker);
					return options;
				} catch (error) {
					const safe = sanitizedError(error);
					throw new NodeOperationError(this.getNode(), `${safe.code}: ${safe.message}`, { description: 'Distribution discovery requires cloudfront:ListDistributions on resource *. Use Enter ID with known IDs to avoid this permission.' });
				} finally {
					client.destroy();
				}
			},
		},
		credentialTest: {
			async awsCloudFrontApiTest(this: ICredentialTestFunctions, credential: ICredentialsDecrypted): Promise<INodeCredentialTestResult> {
				let client: CloudFrontClient | undefined;
				try {
					if (!credential.data) throw new CloudFrontInputError('No credential data was supplied.');
					const testId = credential.data.testDistributionId;
					const distributionId = testId === undefined || testId === '' ? undefined : validateId(testId, 'Test Distribution ID');
					client = createCloudFrontClient(credential.data);
					if (distributionId) await client.send(new GetDistributionCommand({ Id: distributionId }));
					else await client.send(new ListDistributionsCommand({ MaxItems: 1 }));
					return { status: 'OK', message: `Read-only CloudFront credential check succeeded using ${distributionId ? 'GetDistribution' : 'ListDistributions'}. This does not verify permissions for other operations.` };
				} catch (error) {
					const safe = sanitizedError(error);
					const metadata = [safe.httpStatus ? `HTTP ${safe.httpStatus}` : '', safe.requestId ? `Request ID ${safe.requestId}` : ''].filter(Boolean).join('; ');
					return { status: 'Error', message: `${safe.code}: ${safe.message}${metadata ? ` (${metadata})` : ''}. Check AWS credentials and IAM: the check requires GetDistribution on the test distribution, or ListDistributions on resource * when no test ID is supplied.` };
				} finally {
					client?.destroy();
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputs = this.getInputData();
		const prepared: Array<PreparedItem | undefined> = [];
		const results: INodeExecutionData[] = new Array(inputs.length);
		let firstError: { error: SafeAwsError; itemIndex: number } | undefined;
		// Complete local preflight for every item before any mutation, even on continue-on-fail.
		for (let itemIndex = 0; itemIndex < inputs.length; itemIndex++) {
			try {
				prepared[itemIndex] = prepareItem(this, itemIndex);
			} catch (error) {
				const safe = sanitizedError(error);
				firstError ??= { error: safe, itemIndex };
				results[itemIndex] = { json: { error: { ...safe } }, pairedItem: { item: itemIndex } };
			}
		}
		if (firstError && !this.continueOnFail()) {
			throw new NodeOperationError(this.getNode(), `${firstError.error.code}: ${firstError.error.message}`, { itemIndex: firstError.itemIndex, description: JSON.stringify(firstError.error) });
		}
		for (let itemIndex = 0; itemIndex < inputs.length; itemIndex++) {
			const item = prepared[itemIndex];
			if (!item) continue;
			let client: CloudFrontClient | undefined;
			try {
				client = createCloudFrontClient(await this.getCredentials('awsCloudFrontApi', itemIndex));
				results[itemIndex] = { json: await executeItem(client, item), pairedItem: { item: itemIndex } };
			} catch (error) {
				const safe = sanitizedError(error);
				if (!this.continueOnFail()) {
					throw new NodeOperationError(this.getNode(), `${safe.code}: ${safe.message}`, { itemIndex, description: JSON.stringify(safe) });
				}
				results[itemIndex] = { json: { error: { ...safe } }, pairedItem: { item: itemIndex } };
			} finally {
				client?.destroy();
			}
		}
		return [results];
	}
}
