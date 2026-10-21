import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
	isDuplicateEvent,
	verifyPost2allSignature,
} = require('../dist/nodes/Post2allTrigger/signature.js');

const secret = 'whsec_test';
const body = JSON.stringify({ id: 'evt_1', type: 'post.completed', data: { postId: 'p1' } });
const eventId = 'evt_1';
const nowMs = 1_800_000_000_000;
const timestamp = String(nowMs / 1000);
const sign = (value = body, ts = timestamp) =>
	`v1=${createHmac('sha256', secret).update(`${eventId}.${ts}.${value}`).digest('hex')}`;

test('accepts a correctly signed delivery', () => {
	assert.equal(
		verifyPost2allSignature({
			rawBody: body,
			secret,
			eventId,
			timestamp,
			signature: sign(),
			nowMs,
		}),
		true,
	);
});

test('rejects tampered bodies, wrong secrets, stale timestamps, and malformed input', () => {
	const base = { rawBody: body, secret, eventId, timestamp, signature: sign(), nowMs };
	assert.equal(verifyPost2allSignature({ ...base, rawBody: body + ' ' }), false);
	assert.equal(verifyPost2allSignature({ ...base, secret: 'other' }), false);
	assert.equal(verifyPost2allSignature({ ...base, nowMs: nowMs + 301_000 }), false);
	assert.equal(
		verifyPost2allSignature({ ...base, nowMs: nowMs + 301_000, toleranceSeconds: 600 }),
		true,
	);
	assert.equal(verifyPost2allSignature({ ...base, timestamp: 'abc' }), false);
	assert.equal(verifyPost2allSignature({ ...base, signature: 'v1=short' }), false);
});

test('agrees with the published @post2all/sdk verifier when it is available', async () => {
	const sdkPath = new URL('../../post2all-sdk/packages/sdk/dist/webhooks.js', import.meta.url);
	if (!existsSync(sdkPath)) return;
	const { verifyWebhookSignature } = await import(sdkPath.href);
	const input = { rawBody: body, secret, eventId, timestamp, signature: sign() };
	assert.equal(
		verifyWebhookSignature({ ...input, now: new Date(nowMs) }),
		verifyPost2allSignature({ ...input, nowMs }),
	);
	const bad = { ...input, signature: sign('different') };
	assert.equal(
		verifyWebhookSignature({ ...bad, now: new Date(nowMs) }),
		verifyPost2allSignature({ ...bad, nowMs }),
	);
});

test('isDuplicateEvent records new IDs and flags repeats with bounded history', () => {
	const seen = [];
	assert.equal(isDuplicateEvent(seen, 'a'), false);
	assert.equal(isDuplicateEvent(seen, 'a'), true);
	for (let index = 0; index < 500; index++) isDuplicateEvent(seen, `id-${index}`);
	assert.ok(seen.length <= 200);
	assert.equal(isDuplicateEvent(seen, 'a'), false);
});
