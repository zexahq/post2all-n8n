import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import {
	accountOperations,
	mediaOperations,
	postOperations,
	profileOperations,
} from './descriptions';
import {
	buildIdempotencyKey,
	parseJsonObject,
	post2allApiRequest,
	toOffsetDateTime,
} from './GenericFunctions';

type Context = IExecuteFunctions;
type Dict = IDataObject;

function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function buildDelivery(
	context: Context,
	mode: string,
	scheduledAt: unknown,
	itemIndex: number,
): Dict {
	if (mode !== 'scheduled') return { mode };
	if (!scheduledAt) {
		throw new NodeOperationError(context.getNode(), 'Scheduled At is required to schedule a post', {
			itemIndex,
		});
	}
	return { mode, scheduledAt: toOffsetDateTime(String(scheduledAt), context.getTimezone()) };
}

type AccountCache = Map<string, Promise<Map<string, string>>>;

/** Fetches the account list once per execute() call (and per profile scope). */
function getPlatformByAccount(
	context: Context,
	profileId: string | undefined,
	cache: AccountCache,
): Promise<Map<string, string>> {
	const key = profileId ?? '';
	let pending = cache.get(key);
	if (!pending) {
		pending = post2allApiRequest
			.call(context, 'GET', '/accounts', { profileId })
			.then((response) => {
				const map = new Map<string, string>();
				for (const account of asArray<Dict>(response.accounts)) {
					map.set(String(account.id), String(account.platform));
				}
				return map;
			});
		cache.set(key, pending);
		pending.catch(() => cache.delete(key));
	}
	return pending;
}

async function resolveTargets(
	context: Context,
	rawTargets: unknown,
	profileId: string | undefined,
	itemIndex: number,
	cache: AccountCache,
): Promise<Dict[]> {
	const entries = asArray<Dict>((rawTargets as Dict | undefined)?.target);
	if (entries.length === 0) return [];

	const platformByAccount = await getPlatformByAccount(context, profileId, cache);

	return entries.map((entry) => {
		const accountId = String(entry.accountId ?? '');
		const platform = platformByAccount.get(accountId);
		if (!platform) {
			throw new NodeOperationError(
				context.getNode(),
				`Account ${accountId || '(empty)'} was not found in this workspace${profileId ? ' profile' : ''}`,
				{ itemIndex },
			);
		}
		return {
			platform,
			accountId,
			settings: parseJsonObject(context, entry.settings, 'Target settings', itemIndex),
		};
	});
}

async function uploadBinary(
	context: Context,
	binaryPropertyName: string,
	itemIndex: number,
	filenameOverride?: string,
	profileId?: string,
): Promise<Dict> {
	const binary = context.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	const contentType = binary.mimeType;
	if (!/^(image|video)\/[A-Za-z0-9.+-]+$/.test(contentType)) {
		throw new NodeOperationError(
			context.getNode(),
			`Binary field "${binaryPropertyName}" has type "${contentType}". Only image and video files can be uploaded.`,
			{ itemIndex },
		);
	}

	const created = await post2allApiRequest.call(context, 'POST', '/media/uploads', {
		profileId,
		body: {
			filename: filenameOverride || binary.fileName || 'upload',
			contentType,
			fileSize: buffer.length,
		},
	});
	const upload = created.upload as Dict;

	await context.helpers.httpRequest({
		method: 'PUT',
		url: String(upload.uploadUrl),
		headers: { 'Content-Type': contentType },
		body: buffer,
		json: false,
	});

	const confirmed = await post2allApiRequest.call(
		context,
		'POST',
		`/media/uploads/${encodeURIComponent(String(upload.mediaId))}/confirm`,
		{ profileId },
	);
	return confirmed.media as Dict;
}

async function resolveMedia(
	context: Context,
	rawMedia: unknown,
	profileId: string | undefined,
	itemIndex: number,
): Promise<Dict[]> {
	const entries = asArray<Dict>((rawMedia as Dict | undefined)?.item);
	const media: Dict[] = [];
	for (const entry of entries) {
		const altText = typeof entry.altText === 'string' && entry.altText ? entry.altText : undefined;
		let item: Dict;
		if (entry.source === 'id') {
			item = { id: String(entry.mediaId ?? '') };
		} else if (entry.source === 'binary') {
			const uploaded = await uploadBinary(
				context,
				String(entry.binaryPropertyName || 'data'),
				itemIndex,
				undefined,
				profileId,
			);
			item = { id: String(uploaded.id) };
		} else {
			item = { url: String(entry.url ?? '') };
		}
		if (altText) item.altText = altText;
		media.push(item);
	}
	return media;
}

function toItems(context: Context, data: unknown, itemIndex: number): INodeExecutionData[] {
	return context.helpers.constructExecutionMetaData(
		context.helpers.returnJsonArray(data as Dict | Dict[]),
		{ itemData: { item: itemIndex } },
	);
}

export class Post2all implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'post2all',
		name: 'post2all',
		icon: { light: 'file:../../icons/post2all.svg', dark: 'file:../../icons/post2all.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create, schedule, and publish social media posts with post2all',
		defaults: {
			name: 'post2all',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'post2allApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Media', value: 'media' },
					{ name: 'Post', value: 'post' },
					{ name: 'Profile', value: 'profile' },
				],
				default: 'post',
			},
			...accountOperations,
			...mediaOperations,
			...postOperations,
			...profileOperations,
		],
	};

	methods = {
		loadOptions: {
			async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				let profileId: string | undefined;
				try {
					const selected = this.getCurrentNodeParameter('options.profileId');
					if (typeof selected === 'string' && selected) profileId = selected;
				} catch {
					// parameter path may not exist (e.g. inside a fixedCollection); fall back to workspace
				}
				const response = await post2allApiRequest.call(this, 'GET', '/accounts', { profileId });
				return asArray<Dict>(response.accounts).map((account) => {
					const handle = account.username ? ` · @${String(account.username)}` : '';
					const name = String(account.displayName || account.username || account.platformAccountId);
					return {
						name: `${name} (${String(account.platform)}${handle})`,
						value: String(account.id),
					};
				});
			},
			async getProfiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await post2allApiRequest.call(this, 'GET', '/profiles');
				return asArray<Dict>(response.profiles).map((profile) => ({
					name: String(profile.name),
					value: String(profile.id),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const executionId = this.getExecutionId();
		const workflowId = this.getWorkflow().id;
		const accountCache: AccountCache = new Map();

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as Dict;
				const profileId = (options.profileId as string) || undefined;
				let data: unknown;

				if (resource === 'account') {
					if (operation === 'getAll') {
						const response = await post2allApiRequest.call(this, 'GET', '/accounts', {
							profileId,
						});
						data = response.accounts;
					} else if (operation === 'get') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const response = await post2allApiRequest.call(
							this,
							'GET',
							`/accounts/${encodeURIComponent(accountId)}`,
							{ profileId },
						);
						data = response.account ?? response;
					} else if (operation === 'listPlatforms') {
						data = await post2allApiRequest.call(this, 'GET', '/accounts/platforms', { profileId });
					} else if (operation === 'getAnalytics') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						const filters = this.getNodeParameter('analyticsOptions', i, {}) as Dict;
						const qs: Dict = {};
						if (filters.startDate) qs.startDate = filters.startDate;
						if (filters.endDate) qs.endDate = filters.endDate;
						if (filters.refresh) qs.refresh = true;
						data = await post2allApiRequest.call(
							this,
							'GET',
							`/accounts/${encodeURIComponent(accountId)}/analytics`,
							{ qs, profileId },
						);
					} else if (operation === 'disconnect') {
						const accountId = this.getNodeParameter('accountId', i) as string;
						data = await post2allApiRequest.call(
							this,
							'DELETE',
							`/accounts/${encodeURIComponent(accountId)}`,
							{ profileId },
						);
					} else {
						const accountIds = this.getNodeParameter('accountIds', i) as string[];
						if (accountIds.length === 0) {
							throw new NodeOperationError(this.getNode(), 'Select at least one account', {
								itemIndex: i,
							});
						}
						const endpoint =
							operation === 'getPublishingSchema' ? '/publishing-schema' : '/publishing-options';
						data = await post2allApiRequest.call(this, 'POST', endpoint, {
							profileId,
							body: { accountIds },
						});
					}
				} else if (resource === 'profile') {
					const response = await post2allApiRequest.call(this, 'GET', '/profiles');
					data = response.profiles;
				} else if (resource === 'media') {
					const filename = this.getNodeParameter('filename', i, '') as string;
					if (operation === 'uploadFromUrl') {
						const url = this.getNodeParameter('url', i) as string;
						const response = await post2allApiRequest.call(
							this,
							'POST',
							'/media/uploads/from-url',
							{
								body: { url, ...(filename ? { filename } : {}) },
							},
						);
						data = response.media;
					} else {
						const binaryName = this.getNodeParameter('binaryPropertyName', i) as string;
						data = await uploadBinary(this, binaryName, i, filename || undefined);
					}
				} else {
					data = await runPostOperation(this, operation, i, profileId, options, {
						workflowId,
						executionId,
						accountCache,
					});
				}

				returnData.push(...toItems(this, data, i));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push(...toItems(this, { error: (error as Error).message }, i));
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					error.context.itemIndex = i;
					// Already an n8n error carrying the described API message; rethrow it unchanged.
					// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function runPostOperation(
	context: Context,
	operation: string,
	i: number,
	profileId: string | undefined,
	options: Dict,
	run: { workflowId?: string; executionId?: string; accountCache: AccountCache },
): Promise<unknown> {
	if (operation === 'create') {
		const body: Dict = {};
		const content = context.getNodeParameter('content', i, '') as string;
		if (content) body.content = content;

		const targets = await resolveTargets(
			context,
			context.getNodeParameter('targets', i, {}),
			profileId,
			i,
			run.accountCache,
		);
		body.targets = targets;

		const media = await resolveMedia(
			context,
			context.getNodeParameter('media', i, {}),
			profileId,
			i,
		);
		if (media.length > 0) body.media = media;

		body.delivery = buildDelivery(
			context,
			context.getNodeParameter('deliveryMode', i) as string,
			context.getNodeParameter('scheduledAt', i, '') as string,
			i,
		);

		const idempotencyKey =
			(options.idempotencyKey as string) ||
			buildIdempotencyKey([run.workflowId, run.executionId, i]);

		const response = await post2allApiRequest.call(context, 'POST', '/posts', {
			body,
			profileId,
			idempotencyKey,
		});
		return response.post ?? response;
	}

	if (operation === 'getAll') {
		const returnAll = context.getNodeParameter('returnAll', i) as boolean;
		const limit = returnAll ? 100 : (context.getNodeParameter('limit', i) as number);
		const filters = context.getNodeParameter('filters', i, {}) as Dict;
		const posts: Dict[] = [];
		let page = 1;
		for (;;) {
			const qs: Dict = { page, limit: Math.min(limit, 100) };
			if (filters.status) qs.status = filters.status;
			const response = await post2allApiRequest.call(context, 'GET', '/posts', { qs, profileId });
			posts.push(...asArray<Dict>(response.posts));
			const hasMore = Boolean((response.pagination as Dict | undefined)?.hasMore);
			if (!returnAll || !hasMore) break;
			page += 1;
		}
		return returnAll ? posts : posts.slice(0, limit);
	}

	const postId = encodeURIComponent(context.getNodeParameter('postId', i) as string);

	if (operation === 'get') {
		const response = await post2allApiRequest.call(context, 'GET', `/posts/${postId}`, {
			profileId,
		});
		return response.post ?? response;
	}

	if (operation === 'getAnalytics') {
		const refresh = context.getNodeParameter('refresh', i, false) as boolean;
		return await post2allApiRequest.call(context, 'GET', `/posts/${postId}/analytics`, {
			qs: refresh ? { refresh: true } : {},
			profileId,
		});
	}

	if (operation === 'deletePublished') {
		const postAccountId = context.getNodeParameter('postAccountId', i) as string;
		return await post2allApiRequest.call(context, 'DELETE', `/posts/${postId}/published`, {
			body: { postAccountId },
			profileId,
		});
	}

	if (operation === 'update') {
		const fields = context.getNodeParameter('updateFields', i, {}) as Dict;
		const body: Dict = {};
		if (fields.content !== undefined) body.content = fields.content;
		if (fields.deliveryMode !== undefined) {
			body.delivery = buildDelivery(context, String(fields.deliveryMode), fields.scheduledAt, i);
		}
		if (fields.targets !== undefined) {
			body.targets = await resolveTargets(context, fields.targets, profileId, i, run.accountCache);
		}
		if (fields.media !== undefined) {
			body.media = await resolveMedia(context, fields.media, profileId, i);
		}
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(context.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		const response = await post2allApiRequest.call(context, 'PUT', `/posts/${postId}`, {
			body,
			profileId,
		});
		return response.post ?? response;
	}

	if (operation === 'retry') {
		const rescheduleAt = context.getNodeParameter('retryScheduledAt', i, '') as string;
		const body: Dict = rescheduleAt
			? { scheduledAt: toOffsetDateTime(rescheduleAt, context.getTimezone()) }
			: {};
		const response = await post2allApiRequest.call(context, 'POST', `/posts/${postId}/retry`, {
			body,
			profileId,
		});
		return response.post ?? response;
	}

	if (operation === 'cancel') {
		const response = await post2allApiRequest.call(context, 'POST', `/posts/${postId}/cancel`, {
			profileId,
		});
		return response.post ?? response;
	}

	const response = await post2allApiRequest.call(context, 'DELETE', `/posts/${postId}`, {
		profileId,
	});
	return response;
}
