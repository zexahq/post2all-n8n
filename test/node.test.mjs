import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Post2all } = require('../dist/nodes/Post2all/Post2all.node.js');

function fakeContext({ params, httpHandler, continueOnFail = false }) {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ apiKey: 'p2a_test', baseUrl: 'https://api.example.com/v1/' }),
		getNode: () => ({
			name: 'post2all',
			type: 'post2all',
			typeVersion: 1,
			id: 'n1',
			position: [0, 0],
			parameters: {},
		}),
		getTimezone: () => 'Asia/Kolkata',
		getExecutionId: () => 'exec-7',
		getWorkflow: () => ({ id: 'wf-3' }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (_cred, request) => {
				calls.push(request);
				return httpHandler(request);
			},
			constructExecutionMetaData: (data, meta) =>
				data.map((d) => ({ ...d, pairedItem: meta.itemData })),
			returnJsonArray: (value) =>
				(Array.isArray(value) ? value : [value]).map((json) => ({ json })),
		},
	};
	return { ctx, calls };
}

const accountsReply = {
	accounts: [
		{ id: 'acc_li', platform: 'linkedin' },
		{ id: 'acc_x', platform: 'twitter' },
	],
};

test('create resolves platforms, schedules in the workflow timezone, and sets an idempotency key', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'Hello',
			targets: {
				target: [
					{ accountId: 'acc_li', settings: '{"caption":"LI"}' },
					{ accountId: 'acc_x', settings: '{}' },
				],
			},
			media: { item: [{ source: 'url', url: 'https://cdn.example.com/a.png', altText: 'logo' }] },
			deliveryMode: 'scheduled',
			scheduledAt: '2026-10-20T10:00:00',
			options: {},
		},
		httpHandler: (request) =>
			request.url.endsWith('/accounts')
				? accountsReply
				: { post: { id: 'post_1', status: 'scheduled' } },
	});
	const result = await new Post2all().execute.call(ctx);

	assert.equal(result[0][0].json.id, 'post_1');
	const create = calls.find((c) => c.method === 'POST');
	assert.equal(create.url, 'https://api.example.com/v1/posts');
	assert.deepEqual(create.body, {
		content: 'Hello',
		targets: [
			{ platform: 'linkedin', accountId: 'acc_li', settings: { caption: 'LI' } },
			{ platform: 'twitter', accountId: 'acc_x', settings: {} },
		],
		media: [{ url: 'https://cdn.example.com/a.png', altText: 'logo' }],
		delivery: { mode: 'scheduled', scheduledAt: '2026-10-20T10:00:00+05:30' },
	});
	assert.equal(create.headers['Idempotency-Key'], 'n8n-wf-3-exec-7-0');
});

test('create sends the profile scope header and honors a custom idempotency key', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'Draft',
			targets: {},
			media: {},
			deliveryMode: 'draft',
			scheduledAt: '',
			options: { profileId: 'prof_1', idempotencyKey: 'mine-1' },
		},
		httpHandler: () => ({ post: { id: 'post_2' } }),
	});
	await new Post2all().execute.call(ctx);
	assert.equal(calls[0].headers['x-profile-id'], 'prof_1');
	assert.equal(calls[0].headers['Idempotency-Key'], 'mine-1');
	assert.deepEqual(calls[0].body, { targets: [], delivery: { mode: 'draft' }, content: 'Draft' });
});

test('create fails clearly when a target account is not in the workspace', async () => {
	const { ctx } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'x',
			targets: { target: [{ accountId: 'missing', settings: '{}' }] },
			media: {},
			deliveryMode: 'draft',
			scheduledAt: '',
			options: {},
		},
		httpHandler: () => accountsReply,
	});
	await assert.rejects(() => new Post2all().execute.call(ctx), /Account missing was not found/);
});

test('invalid target settings JSON is rejected before any post is created', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'x',
			targets: { target: [{ accountId: 'acc_li', settings: '{oops' }] },
			media: {},
			deliveryMode: 'draft',
			scheduledAt: '',
			options: {},
		},
		httpHandler: () => accountsReply,
	});
	await assert.rejects(() => new Post2all().execute.call(ctx), /valid JSON object/);
	assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('update sends only the fields provided', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'update',
			postId: 'post 1',
			updateFields: { content: 'New copy' },
			options: {},
		},
		httpHandler: () => ({ post: { id: 'post 1' } }),
	});
	await new Post2all().execute.call(ctx);
	assert.equal(calls[0].method, 'PUT');
	assert.equal(calls[0].url, 'https://api.example.com/v1/posts/post%201');
	assert.deepEqual(calls[0].body, { content: 'New copy' });
});

test('getAll pages through results when Return All is enabled', async () => {
	let page = 0;
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'getAll',
			returnAll: true,
			filters: { status: 'scheduled' },
			options: {},
		},
		httpHandler: () => {
			page += 1;
			return { posts: [{ id: `p${page}` }], pagination: { page, limit: 100, hasMore: page < 3 } };
		},
	});
	const result = await new Post2all().execute.call(ctx);
	assert.deepEqual(
		result[0].map((item) => item.json.id),
		['p1', 'p2', 'p3'],
	);
	assert.deepEqual(calls[1].qs, { page: 2, limit: 100, status: 'scheduled' });
});

test('continue on fail returns the error as an item instead of throwing', async () => {
	const { ctx } = fakeContext({
		params: { resource: 'post', operation: 'get', postId: 'p1', options: {} },
		continueOnFail: true,
		httpHandler: () => {
			throw new Error('boom');
		},
	});
	const result = await new Post2all().execute.call(ctx);
	assert.match(result[0][0].json.error, /boom/);
});

test('no request ever carries tags', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'x',
			targets: {},
			media: {},
			deliveryMode: 'draft',
			scheduledAt: '',
			tags: 'a,b',
			options: {},
		},
		httpHandler: () => ({ post: { id: 'p' } }),
	});
	await new Post2all().execute.call(ctx);
	assert.equal('tags' in calls[0].body, false);
});

test('accounts are fetched once per execution for many items', async () => {
	const { ctx, calls } = fakeContext({
		params: {
			resource: 'post',
			operation: 'create',
			content: 'x',
			targets: { target: [{ accountId: 'acc_li', settings: '{}' }] },
			media: {},
			deliveryMode: 'draft',
			scheduledAt: '',
			options: {},
		},
		httpHandler: (r) => (r.method === 'GET' ? accountsReply : { post: { id: 'p' } }),
	});
	ctx.getInputData = () => [{ json: {} }, { json: {} }, { json: {} }];
	await new Post2all().execute.call(ctx);
	assert.equal(calls.filter((c) => c.method === 'GET').length, 1);
	assert.equal(calls.filter((c) => c.method === 'POST').length, 3);
});

test('API errors keep their described message and gain the item index', async () => {
	const { NodeApiError } = require('n8n-workflow');
	const { ctx } = fakeContext({
		params: { resource: 'post', operation: 'get', postId: 'p1', options: {} },
		httpHandler: () => {
			throw {
				message: 'boom',
				httpCode: '400',
				cause: { response: { data: { error: { code: 'X', message: 'Specific API reason' } } } },
			};
		},
	});
	await assert.rejects(
		() => new Post2all().execute.call(ctx),
		(error) => {
			assert.ok(error instanceof NodeApiError);
			assert.match(error.message, /Specific API reason/);
			assert.equal(error.context.itemIndex, 0);
			return true;
		},
	);
});

test('new account and post operations call the documented endpoints', async () => {
	const run = async (params) => {
		const { ctx, calls } = fakeContext({
			params: { options: {}, ...params },
			httpHandler: () => ({ ok: true }),
		});
		await new Post2all().execute.call(ctx);
		return calls[0];
	};
	let c = await run({ resource: 'account', operation: 'listPlatforms' });
	assert.equal(`${c.method} ${c.url}`, 'GET https://api.example.com/v1/accounts/platforms');
	c = await run({ resource: 'account', operation: 'disconnect', accountId: 'a 1' });
	assert.equal(`${c.method} ${c.url}`, 'DELETE https://api.example.com/v1/accounts/a%201');
	c = await run({
		resource: 'account',
		operation: 'getAnalytics',
		accountId: 'a1',
		analyticsOptions: { startDate: '2026-10-01', endDate: '2026-10-07', refresh: true },
	});
	assert.equal(c.url, 'https://api.example.com/v1/accounts/a1/analytics');
	assert.deepEqual(c.qs, { startDate: '2026-10-01', endDate: '2026-10-07', refresh: true });
	c = await run({ resource: 'post', operation: 'getAnalytics', postId: 'p1', refresh: false });
	assert.equal(`${c.method} ${c.url}`, 'GET https://api.example.com/v1/posts/p1/analytics');
	c = await run({
		resource: 'post',
		operation: 'deletePublished',
		postId: 'p1',
		postAccountId: 'pa_1',
	});
	assert.equal(`${c.method} ${c.url}`, 'DELETE https://api.example.com/v1/posts/p1/published');
	assert.deepEqual(c.body, { postAccountId: 'pa_1' });
});
