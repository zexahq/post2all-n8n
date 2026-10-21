import type { INodeProperties } from 'n8n-workflow';

const postStatuses = [
	'draft',
	'scheduled',
	'publishing',
	'published',
	'completed',
	'partially_failed',
	'failed',
];

const profileOption: INodeProperties = {
	displayName: 'Profile Name or ID',
	name: 'profileId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getProfiles' },
	default: '',
	description:
		'Limit the request to one profile of the workspace. Leave empty for the whole workspace. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const targetsField: INodeProperties = {
	displayName: 'Targets',
	name: 'targets',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add Target',
	description:
		'Connected accounts to publish to, each with its own platform settings. Use the Get Publishing Schema operation to see the settings each account accepts.',
	options: [
		{
			displayName: 'Target',
			name: 'target',
			values: [
				{
					displayName: 'Account Name or ID',
					name: 'accountId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getAccounts' },
					default: '',
					required: true,
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Settings (JSON)',
					name: 'settings',
					type: 'json',
					default: '{}',
					description:
						'Platform-specific settings for this account, for example {"caption": "LinkedIn copy"} or {"channelId": "123"}. Unknown fields are rejected.',
				},
			],
		},
	],
};

const mediaField: INodeProperties = {
	displayName: 'Media',
	name: 'media',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add Media',
	description: 'Images or videos to attach. The post type is inferred from the media.',
	options: [
		{
			displayName: 'Item',
			name: 'item',
			values: [
				{
					displayName: 'Alt Text',
					name: 'altText',
					type: 'string',
					default: '',
					description: 'Accessibility description, on platforms that support it',
				},
				{
					displayName: 'Input Binary Field',
					name: 'binaryPropertyName',
					type: 'string',
					default: 'data',
					description: 'Name of the binary property that holds the file',
				},
				{
					displayName: 'Media ID',
					name: 'mediaId',
					type: 'string',
					default: '',
				},
				{
					displayName: 'Source',
					name: 'source',
					type: 'options',
					default: 'url',
					options: [
						{
							name: 'Binary Data',
							value: 'binary',
							description: 'Upload a file from the incoming item',
						},
						{
							name: 'Existing Media ID',
							value: 'id',
							description: 'Media already uploaded to post2all',
						},
						{
							name: 'Public HTTPS URL',
							value: 'url',
							description: 'A publicly reachable file that stays online until publishing completes',
						},
					],
				},
				{
					displayName: 'URL',
					name: 'url',
					type: 'string',
					default: '',
					placeholder: 'https://cdn.example.com/image.png',
				},
			],
		},
	],
};

const deliveryFields = (operation: string[]): INodeProperties[] => [
	{
		displayName: 'Delivery',
		name: 'deliveryMode',
		type: 'options',
		default: 'draft',
		displayOptions: { show: { resource: ['post'], operation } },
		options: [
			{ name: 'Draft', value: 'draft', description: 'Save without publishing' },
			{ name: 'Publish Now', value: 'now', description: 'Validate and publish immediately' },
			{ name: 'Schedule', value: 'scheduled', description: 'Publish at a set time' },
		],
	},
	{
		displayName: 'Scheduled At',
		name: 'scheduledAt',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['post'], operation, deliveryMode: ['scheduled'] } },
		description:
			'Interpreted in the workflow timezone unless the value already includes an offset such as +05:30 or Z',
	},
];

export const accountOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['account'] } },
		default: 'getAll',
		options: [
			{
				name: 'Disconnect',
				value: 'disconnect',
				action: 'Disconnect an account',
				description: 'Disconnect a connected social account from post2all',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get an account',
				description: 'Get one connected account',
			},
			{
				name: 'Get Analytics',
				value: 'getAnalytics',
				action: 'Get account analytics',
				description: 'Get analytics metrics and time series for one account',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many accounts',
				description: 'List the connected social accounts',
			},
			{
				name: 'Get Publishing Options',
				value: 'getPublishingOptions',
				action: 'Get publishing options',
				description: 'Account-dependent values such as Discord channels or TikTok creator limits',
			},
			{
				name: 'Get Publishing Schema',
				value: 'getPublishingSchema',
				action: 'Get publishing schema',
				description: 'Limits, fields, and fixed choices for the selected accounts',
			},
			{
				name: 'List Platforms',
				value: 'listPlatforms',
				action: 'List supported platforms',
				description: 'List supported platforms with connection details and account slot usage',
			},
		],
	},
	{
		displayName: 'Account Name or ID',
		name: 'accountId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getAccounts' },
		default: '',
		required: true,
		displayOptions: {
			show: { resource: ['account'], operation: ['get', 'getAnalytics', 'disconnect'] },
		},
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Account Names or IDs',
		name: 'accountIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getAccounts' },
		default: [],
		required: true,
		displayOptions: {
			show: { resource: ['account'], operation: ['getPublishingSchema', 'getPublishingOptions'] },
		},
		description:
			'Request all accounts in one call. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Analytics Options',
		name: 'analyticsOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['account'], operation: ['getAnalytics'] } },
		options: [
			{
				displayName: 'End Date',
				name: 'endDate',
				type: 'string',
				default: '',
				placeholder: '2026-10-31',
				description: 'Last day of the range as YYYY-MM-DD (UTC). Defaults to today.',
			},
			{
				displayName: 'Force Refresh',
				name: 'refresh',
				type: 'boolean',
				default: false,
				description: 'Whether to bypass cached analytics and fetch fresh data from the platform',
			},
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'string',
				default: '',
				placeholder: '2026-10-01',
				description:
					'First day of the range as YYYY-MM-DD (UTC). Defaults to the recent default range.',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['account'] } },
		options: [profileOption],
	},
];

export const mediaOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['media'] } },
		default: 'uploadFromUrl',
		options: [
			{
				name: 'Upload From Binary',
				value: 'uploadBinary',
				action: 'Upload media from binary data',
				description: 'Upload a file from the incoming item to post2all storage',
			},
			{
				name: 'Upload From URL',
				value: 'uploadFromUrl',
				action: 'Upload media from a URL',
				description: 'Import a public HTTPS file into post2all storage',
			},
		],
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://cdn.example.com/video.mp4',
		displayOptions: { show: { resource: ['media'], operation: ['uploadFromUrl'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['media'], operation: ['uploadBinary'] } },
		description: 'Name of the binary property that holds the file',
	},
	{
		displayName: 'File Name',
		name: 'filename',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['media'] } },
		description: 'Optional file name override',
	},
];

export const profileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['profile'] } },
		default: 'getAll',
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many profiles',
				description: 'List the profiles in the workspace',
			},
		],
	},
];

export const postOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['post'] } },
		default: 'create',
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				action: 'Cancel a scheduled post',
				description: 'Stop a scheduled post from publishing',
			},
			{
				name: 'Create',
				value: 'create',
				action: 'Create a post',
				description: 'Create a draft, schedule a post, or publish now',
			},
			{
				name: 'Delete',
				value: 'delete',
				action: 'Delete a post',
				description: 'Delete a post from post2all',
			},
			{
				name: 'Delete Published',
				value: 'deletePublished',
				action: 'Delete a published post from the platform',
				description:
					'Delete the live post on one platform target. Only available for platforms where deletion is supported.',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a post',
				description: 'Get a post with its per-account publishing status',
			},
			{
				name: 'Get Analytics',
				value: 'getAnalytics',
				action: 'Get post analytics',
				description: 'Get engagement metrics for each published target of a post',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many posts',
				description: 'List posts, optionally filtered by status',
			},
			{
				name: 'Retry',
				value: 'retry',
				action: 'Retry a failed post',
				description: 'Retry the failed targets of a post',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a post',
				description: 'Change the content, schedule, targets, or media',
			},
		],
	},
	{
		displayName: 'Post ID',
		name: 'postId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['post'],
				operation: [
					'get',
					'update',
					'cancel',
					'retry',
					'delete',
					'deletePublished',
					'getAnalytics',
				],
			},
		},
	},
	{
		displayName: 'Post Target ID',
		name: 'postAccountId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['post'], operation: ['deletePublished'] } },
		description:
			"ID of the post target (per-account entry in the post's targets) whose live post should be deleted from the platform",
	},
	{
		displayName: 'Force Refresh',
		name: 'refresh',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['post'], operation: ['getAnalytics'] } },
		description: 'Whether to bypass cached analytics and fetch fresh data from the platform',
	},

	// ─── Create ──────────────────────────────────────────────────────────────
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		description: 'The post text. Required unless the post has media or is a draft.',
	},
	{
		...targetsField,
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		...mediaField,
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	...deliveryFields(['create']),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		options: [
			profileOption,
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Repeating a request with the same key returns the original post instead of creating another. Defaults to a key derived from the workflow, execution, and item, so automatic retries never publish twice.',
			},
		],
	},

	// ─── Update ──────────────────────────────────────────────────────────────
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['post'], operation: ['update'] } },
		options: [
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Delivery',
				name: 'deliveryMode',
				type: 'options',
				default: 'draft',
				options: [
					{ name: 'Draft', value: 'draft' },
					{ name: 'Publish Now', value: 'now' },
					{ name: 'Schedule', value: 'scheduled' },
				],
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description: 'Used when Delivery is Schedule. Interpreted in the workflow timezone.',
			},
			mediaField,
			targetsField,
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['post'],
				operation: [
					'get',
					'getAll',
					'update',
					'cancel',
					'retry',
					'delete',
					'deletePublished',
					'getAnalytics',
				],
			},
		},
		options: [profileOption],
	},

	// ─── Retry ───────────────────────────────────────────────────────────────
	{
		displayName: 'Reschedule At',
		name: 'retryScheduledAt',
		type: 'dateTime',
		default: '',
		displayOptions: { show: { resource: ['post'], operation: ['retry'] } },
		description: 'Optional new publish time. Leave empty to retry as soon as possible.',
	},

	// ─── Get Many ────────────────────────────────────────────────────────────
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['post'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		displayOptions: { show: { resource: ['post'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['post'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'scheduled',
				options: postStatuses.map((status) => ({
					name: status
						.split('_')
						.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
						.join(' '),
					value: status,
				})),
			},
		],
	},
];
