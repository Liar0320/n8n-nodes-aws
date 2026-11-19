import type {
	Distribution,
	DistributionSummary,
	Invalidation,
	InvalidationSummary,
} from '@aws-sdk/client-cloudfront';
import type { IDataObject } from 'n8n-workflow';

/** Local errors contain only deliberately authored messages, never request context. */
export class CloudFrontInputError extends Error {
	constructor(message: string, readonly code = 'ValidationError') {
		super(message);
		this.name = code;
	}
}

export function validateId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
		throw new CloudFrontInputError(`${label} must be a non-empty alphanumeric AWS ID, not an ARN, URL, or value containing whitespace.`);
	}
	return value;
}

/** Preserve every nonblank path byte: never trim, decode, normalize, or append a wildcard. */
export function parseInvalidationPaths(value: unknown): string[] {
	if (typeof value !== 'string') {
		throw new CloudFrontInputError('Paths must be a string containing one distribution-relative path per line.');
	}
	const paths = new Set<string>();
	for (const path of value.split(/\r\n|\n|\r/)) {
		if (path.trim() === '') continue;
		if (!path.startsWith('/')) {
			throw new CloudFrontInputError('Every path must begin with a slash and be relative to the distribution, not a full URL.');
		}
		if (path.length > 4000) {
			throw new CloudFrontInputError('Each invalidation path must be at most 4,000 characters.');
		}
		// AWS requires RFC 1738 unsafe and non-ASCII characters to be URL-encoded.
		// Asterisks inside a path are literal matches; only the final asterisk is a wildcard.
		if (/[^\x21-\x7e]|[<>#%"{}|\\^[\]`~]/.test(path.replace(/%[0-9a-f]{2}/gi, ''))) {
			throw new CloudFrontInputError('Paths must URL-encode whitespace, non-ASCII, and unsafe characters and use valid percent escapes; tilde is unsupported even when encoded.');
		}
		if (/%7e/i.test(path)) {
			throw new CloudFrontInputError('CloudFront invalidation paths cannot contain tilde, including URL-encoded tilde (%7E).');
		}
		paths.add(path);
	}
	if (paths.size === 0) {
		throw new CloudFrontInputError('Provide at least one explicit invalidation path. No wildcard is added automatically.');
	}
	return [...paths];
}

export function validateCallerReference(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new CloudFrontInputError('Caller Reference is required. Supply a stable upstream value and reuse it only for the identical logical batch.');
	}
	return value;
}

export function validatePageSize(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
		throw new CloudFrontInputError('Page Size must be an integer from 1 to 100.');
	}
	return value;
}

export function nextPageMarker(
	isTruncated: boolean | undefined,
	nextMarker: string | undefined,
	seenMarkers: Set<string>,
): string | undefined {
	if (!isTruncated) return undefined;
	if (!nextMarker || seenMarkers.has(nextMarker)) {
		throw new CloudFrontInputError('AWS returned a truncated page without a new NextMarker; pagination cannot safely continue.', 'InvalidPaginationResponse');
	}
	seenMarkers.add(nextMarker);
	return nextMarker;
}

export function distributionOutput(distribution: Distribution | DistributionSummary): IDataObject {
	const config = 'DistributionConfig' in distribution ? distribution.DistributionConfig : undefined;
	const summary = distribution as DistributionSummary;
	return {
		distributionId: distribution.Id,
		arn: distribution.ARN ?? null,
		domainName: distribution.DomainName,
		aliases: config?.Aliases?.Items ?? summary.Aliases?.Items ?? [],
		enabled: config?.Enabled ?? summary.Enabled,
		status: distribution.Status,
		comment: config?.Comment ?? summary.Comment ?? '',
		lastModifiedTime: distribution.LastModifiedTime?.toISOString() ?? null,
	};
}

export function distributionDetails(distribution: Distribution, etag?: string): IDataObject {
	const config = distribution.DistributionConfig;
	return {
		...distributionOutput(distribution),
		etag: etag ?? null,
		inProgressInvalidationBatches: distribution.InProgressInvalidationBatches,
		defaultRootObject: config?.DefaultRootObject ?? null,
		httpVersion: config?.HttpVersion ?? null,
		isIpv6Enabled: config?.IsIPV6Enabled ?? null,
		priceClass: config?.PriceClass ?? null,
		origins: (config?.Origins?.Items ?? []).map((origin) => ({
			id: origin.Id,
			domainName: origin.DomainName,
			originPath: origin.OriginPath ?? '',
		})),
	};
}

export function invalidationOutput(
	distributionId: string,
	invalidation: Invalidation | InvalidationSummary,
): IDataObject {
	const batch = 'InvalidationBatch' in invalidation ? invalidation.InvalidationBatch : undefined;
	return {
		distributionId,
		invalidationId: invalidation.Id,
		status: invalidation.Status,
		createTime: invalidation.CreateTime?.toISOString() ?? null,
		...(batch ? { callerReference: batch.CallerReference, paths: batch.Paths?.Items ?? [] } : {}),
	};
}
