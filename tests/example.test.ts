import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const workflow = JSON.parse(readFileSync(new URL('../examples/cloudfront-invalidation.json', import.meta.url), 'utf8'));
const assess = workflow.nodes.find((node: { name: string }) => node.name === 'Assess AWS Result').parameters.jsCode;
const request = { distributionId: 'TESTDIST', paths: '/Reviewed?case=A', callerReference: 'durable-event-1', deadline: 2000, pollSeconds: 10 };
const created = { distributionId: 'TESTDIST', invalidationId: 'TESTINVALIDATION', status: 'InProgress' };
function evaluate(result: object, now: number) {
	const context = vm.createContext({
		$: (name: string) => ({ first: () => ({ json: name === 'Prepare Request' ? request : created }) }),
		$input: { first: () => ({ json: result }) },
		Date: class extends Date { static now() { return now; } },
	});
	return JSON.parse(JSON.stringify(vm.runInContext(`(function(){${assess}})()`, context)))[0].json;
}

test('example keeps submission distinct from completion and preserves durable request state', () => {
	const pending = evaluate(created, 1000);
	assert.equal(pending.outcome, 'poll');
	assert.equal(pending.deadline, request.deadline);
	assert.equal(pending.callerReference, request.callerReference);
	assert.equal(pending.paths, request.paths);
	assert.equal(pending.invalidationId, created.invalidationId);
	const completed = evaluate({ ...created, status: 'Completed' }, 1999);
	assert.equal(completed.outcome, 'completed');
	assert.equal(completed.status, 'Completed');
});

test('example treats late completion as timeout, not confirmation, without extending deadline', () => {
	const timedOut = evaluate({ ...created, status: 'Completed' }, 2000);
	assert.equal(timedOut.outcome, 'timeout');
	assert.equal(timedOut.deadline, 2000);
	assert.equal(timedOut.invalidationId, created.invalidationId);
});

test('example separates AWS errors, unexpected states, and mismatched response identity', () => {
	const error = evaluate({ error: { code: 'AccessDenied', httpStatus: 403, requestId: 'test-request', message: 'private context', headers: { authorization: 'hidden' } } }, 1000);
	assert.equal(error.outcome, 'error');
	assert.equal(error.error.code, 'AccessDenied');
	assert.doesNotMatch(JSON.stringify(error), /private context|authorization|hidden/);
	assert.equal(evaluate({ ...created, status: 'Failed' }, 1000).error.code, 'UnexpectedStatus');
	assert.equal(evaluate({ ...created, invalidationId: 'OTHER' }, 1000).error.code, 'UnexpectedResponse');
});
