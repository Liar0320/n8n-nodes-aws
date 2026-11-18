import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
  ...configWithoutCloudSupport,
  { ignores: ['.artifacts/**'] },
  {
    files: ['package.json'],
    rules: {
      // Self-hosted package: the required official AWS SDK must ship at runtime.
      // This is not an n8n Cloud verified package.
      '@n8n/community-nodes/no-runtime-dependencies': 'off',
      // Public GitHub identity is supplied; do not invent an owner's email.
      '@n8n/community-nodes/valid-author': 'off',
    },
  },
  {
    files: ['nodes/CloudFront/AwsCloudFront.node.ts'],
    rules: {
      // Mutating CDN operations must not be offered as autonomous AI tools.
      '@n8n/community-nodes/node-usable-as-tool': 'off',
      // Internal authored validation errors are sanitized into n8n errors at the boundary.
      'n8n-nodes-base/node-execute-block-wrong-error-thrown': 'off',
    },
  },
  {
    files: ['nodes/CloudFront/properties.ts'],
    rules: {
      // A page size is not a total-result limit: preserve the accurate UI contract.
      'n8n-nodes-base/node-param-description-wrong-for-return-all': 'off',
    },
  },
];
