import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AwsCloudFrontApi implements ICredentialType {
	name = 'awsCloudFrontApi';
	displayName = 'AWS CloudFront API';
	documentationUrl = 'https://github.com/liar0320/n8n-nodes-aws#credentials';
	icon = 'file:../nodes/CloudFront/cloudfront.svg' as const;
	properties: INodeProperties[] = [
		{
			displayName: 'Access Key ID',
			name: 'accessKeyId',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Secret Access Key',
			name: 'secretAccessKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Session Token',
			name: 'sessionToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Optional temporary AWS session token. Refresh expired credentials in n8n.',
		},
		{
			displayName: 'Test Distribution ID',
			name: 'testDistributionId',
			type: 'string',
			default: '',
			description: 'Optional known distribution for the read-only credential test (GetDistribution). If empty, the test requires account-wide ListDistributions permission.',
		},
	];
}
