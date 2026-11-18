/* Copied into the isolated smoke directory and loaded only by its n8n CLI processes. */
'use strict';
const assert = require('node:assert/strict');
const { appendFileSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const net = require('node:net');

const packageRequire = createRequire(path.join(process.env.N8N_SMOKE_PACKAGE, 'package.json'));
const { CloudFrontClient } = packageRequire('@aws-sdk/client-cloudfront');
const fakeCredentials = JSON.parse(process.env.N8N_SMOKE_CREDENTIALS);
const plan = process.env.N8N_SMOKE_PLAN
  ? JSON.parse(readFileSync(process.env.N8N_SMOKE_PLAN, 'utf8')) : [];
let cursor = 0;
function record(entry) {
  if (process.env.N8N_SMOKE_CALLS) appendFileSync(process.env.N8N_SMOKE_CALLS, `${JSON.stringify(entry)}\n`);
}
function reviveDates(key, value) {
  return ['CreateTime', 'LastModifiedTime'].includes(key) && typeof value === 'string'
    ? new Date(value) : value;
}
// Even a missing or broken SDK interception must never contact AWS or another external service.
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = args[0];
  const host = typeof options === 'object' && options !== null
    ? options.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  const unixSocket = (typeof options === 'string' && options.startsWith('/'))
    || (typeof options === 'object' && options !== null && typeof options.path === 'string');
  if (!unixSocket && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    const message = `Smoke forbids external network connections (${host})`;
    record({ failure: message });
    throw new Error(message);
  }
  return originalConnect.apply(this, args);
};

// Replace the installed SDK's command boundary, not the community node or n8n execution context.
// The actual n8n credential decryption and expression engine run before reaching this seam.
CloudFrontClient.prototype.send = async function (command) {
  const name = command.constructor.name;
  const input = JSON.parse(JSON.stringify(command.input));
  try {
    assert.ok(['CreateInvalidationCommand', 'GetDistributionCommand', 'GetInvalidationCommand',
      'ListDistributionsCommand', 'ListInvalidationsCommand'].includes(name), `Unexpected command: ${name}`);
    const expected = plan[cursor++];
    assert.ok(expected, `Unexpected SDK call ${name}`);
    assert.equal(name, expected.command);
    assert.deepEqual(input, expected.input);
    const credentials = await this.config.credentials();
    assert.equal(credentials.accessKeyId, fakeCredentials.accessKeyId);
    assert.equal(credentials.secretAccessKey, fakeCredentials.secretAccessKey);
    assert.equal(credentials.sessionToken, fakeCredentials.sessionToken);
    assert.equal(await this.config.region(), 'us-east-1');
    const endpoint = await this.config.endpoint();
    assert.equal(endpoint.hostname, 'cloudfront.amazonaws.com');
    assert.equal(endpoint.protocol, 'https:');
    record({ command: name, input, fakeCredentialsVerified: true });
    if (expected.error) {
      const error = Object.assign(new Error(expected.error.message), expected.error);
      throw error;
    }
    return JSON.parse(JSON.stringify(expected.output), reviveDates);
  } catch (error) {
    // Planned AWS failures belong to the node's continueOnFail path, not fixture failures.
    const expected = plan[cursor - 1];
    if (!expected?.error || error.name !== expected.error.name || error.message !== expected.error.message) {
      record({ failure: error.message, command: name, input });
    }
    throw error;
  }
};
