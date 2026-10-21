import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Post2allTrigger } = require('../dist/nodes/Post2allTrigger/Post2allTrigger.node.js');

const secret = 'whsec_test';

function delivery(type = 'post.completed', eventId = 'evt_1') {
	const payload = { id: eventId, type, data: { postId: 'p1' } };
	const raw = JSON.stringify(payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = `v1=${createHmac('sha256', secret).update(`${eventId}.${timestamp}.${raw}`).digest('hex')}`;
	return {
		payload,
		raw,
		headers: {
			'x-post2all-event-id': eventId,
			'x-post2all-timestamp': timestamp,
			'x-post2all-signature': signature,
		},
	};
}

function context(
	{ raw, headers, payload },
	{ events = ['post.completed'], options = {}, staticData = {}, signingSecret = secret } = {},
) {
	const responses = [];
	const response = {
		status(code) {
			responses.push({ code });
			return this;
		},
		json(body) {
			responses.at(-1).body = body;
		},
	};
	return {
		responses,
		ctx: {
			getRequestObject: () => ({ rawBody: raw === undefined ? undefined : Buffer.from(raw) }),
			getResponseObject: () => response,
			getHeaderData: () => headers,
			getCredentials: async () => ({ signingSecret }),
			getNodeParameter: (name, fallback) => ({ options, events })[name] ?? fallback,
			getBodyData: () => payload,
			getWorkflowStaticData: () => staticData,
			helpers: { returnJsonArray: (value) => [{ json: value }] },
		},
	};
}

const trigger = new Post2allTrigger();

test('a valid delivery starts the workflow with the event payload', async () => {
	const { ctx } = context(delivery());
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.workflowData[0][0].json.type, 'post.completed');
});

test('an invalid signature is rejected with 401 and never reaches the workflow', async () => {
	const d = delivery();
	d.headers['x-post2all-signature'] = 'v1=' + '0'.repeat(64);
	const { ctx, responses } = context(d);
	const result = await trigger.webhook.call(ctx);
	assert.equal(result.noWebhookResponse, true);
	assert.equal(result.workflowData, undefined);
	assert.equal(responses[0].code, 401);
});

test('a delivery without a raw body or headers is rejected', async () => {
	const d = delivery();
	const { ctx: noBody, responses } = context({ ...d, raw: undefined });
	assert.equal((await trigger.webhook.call(noBody)).noWebhookResponse, true);
	assert.equal(responses[0].code, 401);
	const { ctx: noHeaders } = context({ ...d, headers: {} });
	assert.equal((await trigger.webhook.call(noHeaders)).noWebhookResponse, true);
});

test('events outside the selection are acknowledged but do not run the workflow', async () => {
	const { ctx } = context(delivery('post.created'), { events: ['post.completed'] });
	const result = await trigger.webhook.call(ctx);
	assert.deepEqual(result.webhookResponse, { ignored: true });
	assert.equal(result.workflowData, undefined);
});

test('duplicate event IDs are skipped by default and allowed when disabled', async () => {
	const staticData = {};
	const first = await trigger.webhook.call(context(delivery(), { staticData }).ctx);
	assert.ok(first.workflowData);
	const second = await trigger.webhook.call(context(delivery(), { staticData }).ctx);
	assert.deepEqual(second.webhookResponse, { duplicate: true });
	const third = await trigger.webhook.call(
		context(delivery(), { staticData, options: { ignoreDuplicates: false } }).ctx,
	);
	assert.ok(third.workflowData);
});

test('an empty signing secret rejects every delivery, even one signed with an empty key', async () => {
	const payload = { id: 'evt_1', type: 'post.completed', data: {} };
	const raw = JSON.stringify(payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = `v1=${createHmac('sha256', '').update(`evt_1.${timestamp}.${raw}`).digest('hex')}`;
	const headers = {
		'x-post2all-event-id': 'evt_1',
		'x-post2all-timestamp': timestamp,
		'x-post2all-signature': signature,
	};
	for (const signingSecret of ['', undefined]) {
		const { ctx, responses } = context({ payload, raw, headers }, { signingSecret });
		const result = await trigger.webhook.call(ctx);
		assert.equal(result.noWebhookResponse, true);
		assert.equal(result.workflowData, undefined);
		assert.equal(responses[0].code, 401);
	}
});
