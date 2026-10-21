import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
	buildIdempotencyKey,
	describeApiError,
	resolveBaseUrl,
	toOffsetDateTime,
} = require('../dist/nodes/Post2all/GenericFunctions.js');

test('toOffsetDateTime applies the workflow timezone offset', () => {
	assert.equal(
		toOffsetDateTime('2026-10-20T10:00:00', 'Asia/Kolkata'),
		'2026-10-20T10:00:00+05:30',
	);
	assert.equal(toOffsetDateTime('2026-10-20T10:00', 'UTC'), '2026-10-20T10:00:00+00:00');
});

test('toOffsetDateTime follows daylight saving rules', () => {
	assert.equal(
		toOffsetDateTime('2026-07-01T09:00:00', 'America/New_York'),
		'2026-07-01T09:00:00-04:00',
	);
	assert.equal(
		toOffsetDateTime('2026-12-01T09:00:00', 'America/New_York'),
		'2026-12-01T09:00:00-05:00',
	);
});

test('toOffsetDateTime leaves values that already carry an offset untouched', () => {
	assert.equal(
		toOffsetDateTime('2026-10-20T10:00:00+02:00', 'Asia/Kolkata'),
		'2026-10-20T10:00:00+02:00',
	);
	assert.equal(
		toOffsetDateTime('2026-10-20T10:00:00.000Z', 'Asia/Kolkata'),
		'2026-10-20T10:00:00.000Z',
	);
});

test('toOffsetDateTime falls back to UTC for an unknown timezone', () => {
	assert.equal(toOffsetDateTime('2026-10-20T10:00:00', 'Not/AZone'), '2026-10-20T10:00:00+00:00');
});

test('resolveBaseUrl trims trailing slashes and defaults', () => {
	assert.equal(resolveBaseUrl(undefined), 'https://app.post2all.com/api/v1');
	assert.equal(resolveBaseUrl('  '), 'https://app.post2all.com/api/v1');
	assert.equal(
		resolveBaseUrl('https://staging.example.com/api/v1//'),
		'https://staging.example.com/api/v1',
	);
});

test('buildIdempotencyKey is stable, visible ASCII, and bounded', () => {
	const key = buildIdempotencyKey(['wf 1', 'exec-9', 2]);
	assert.equal(key, buildIdempotencyKey(['wf 1', 'exec-9', 2]));
	assert.match(key, /^[\x21-\x7e]+$/);
	assert.ok(buildIdempotencyKey(['x'.repeat(400)]).length <= 255);
	assert.equal(buildIdempotencyKey([undefined, 'a', '']), 'n8n-a');
});

test('describeApiError surfaces the API message and the retry hint', () => {
	const error = {
		message: 'Request failed',
		httpCode: '429',
		cause: {
			response: {
				data: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
				headers: { 'retry-after': '120' },
			},
		},
	};
	assert.equal(
		describeApiError(error),
		'RATE_LIMITED: Too many requests (retry after 120 seconds)',
	);
	assert.equal(describeApiError({ message: 'boom' }), 'boom');
});
