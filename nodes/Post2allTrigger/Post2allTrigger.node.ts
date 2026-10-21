import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { isDuplicateEvent, verifyPost2allSignature } from './signature';

const EVENTS: Array<{ name: string; value: string; description: string }> = [
	{
		name: 'Account Connected',
		value: 'account.connected',
		description: 'A social account was connected',
	},
	{
		name: 'Account Disconnected',
		value: 'account.disconnected',
		description: 'A social account was disconnected',
	},
	{
		name: 'Account Reconnect Required',
		value: 'account.reconnect_required',
		description: 'An account needs to be reconnected',
	},
	{
		name: 'Billing Balance Low',
		value: 'billing.balance_low',
		description: 'The prepaid balance is low',
	},
	{
		name: 'Billing Restored',
		value: 'billing.restored',
		description: 'Credit access became active again',
	},
	{
		name: 'Billing Suspended',
		value: 'billing.suspended',
		description: 'Credit access was suspended',
	},
	{
		name: 'Billing X Spend 100%',
		value: 'billing.x_spend_100',
		description: 'X spend reached the alert amount',
	},
	{
		name: 'Billing X Spend 80%',
		value: 'billing.x_spend_80',
		description: 'X spend crossed 80% of the alert amount',
	},
	{
		name: 'Post Cancelled',
		value: 'post.cancelled',
		description: 'A scheduled post was cancelled',
	},
	{
		name: 'Post Completed',
		value: 'post.completed',
		description: 'Every target reached its successful terminal state',
	},
	{ name: 'Post Created', value: 'post.created', description: 'A new post was created' },
	{ name: 'Post Failed', value: 'post.failed', description: 'Every target failed' },
	{
		name: 'Post Partially Failed',
		value: 'post.partially_failed',
		description: 'Some targets published and some failed',
	},
	{
		name: 'Post Published',
		value: 'post.published',
		description: 'Every target published successfully',
	},
	{
		name: 'Post Scheduled',
		value: 'post.scheduled',
		description: 'A post was scheduled or rescheduled',
	},
	{
		name: 'Post Target Deferred',
		value: 'post.target.deferred',
		description: 'One target was held for a retry',
	},
	{
		name: 'Post Target Failed',
		value: 'post.target.failed',
		description: 'One target failed permanently',
	},
	{
		name: 'Post Target Published',
		value: 'post.target.published',
		description: 'One target published successfully',
	},
	{
		name: 'Post Target Uploaded',
		value: 'post.target.uploaded',
		description: 'One target accepted the upload and is processing it',
	},
];

export class Post2allTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'post2all Trigger',
		name: 'post2allTrigger',
		icon: { light: 'file:../../icons/post2all.svg', dark: 'file:../../icons/post2all.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts a workflow when post2all publishes, schedules, or fails a post',
		defaults: {
			name: 'post2all Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'post2allApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"In post2all, open Webhooks in the workspace dashboard and create an endpoint that points at this node's Production or Test URL. Copy its signing secret into the Webhook Signing Secret field of the post2all API credential. The signing secret is required: deliveries are rejected with a 401 while it is empty. Every delivery is verified before the workflow runs.",
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['post.completed', 'post.failed', 'post.partially_failed'],
				options: EVENTS,
				description:
					'Only these events start the workflow. Also subscribe the endpoint to them in the post2all dashboard.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Ignore Duplicate Deliveries',
						name: 'ignoreDuplicates',
						type: 'boolean',
						default: true,
						description:
							'Whether to skip an event ID that was already received. post2all delivers at least once, so duplicates are normal after retries.',
					},
					{
						displayName: 'Timestamp Tolerance (Seconds)',
						name: 'toleranceSeconds',
						type: 'number',
						typeOptions: { minValue: 30 },
						default: 300,
						description: 'Reject deliveries whose signed timestamp is older or newer than this',
					},
				],
			},
		],
	};

	// post2all webhook endpoints are managed in the dashboard (there is no public endpoint API),
	// so there is nothing to register or clean up on the service side.
	webhookMethods = {
		default: {
			async checkExists(): Promise<boolean> {
				return true;
			},
			async create(): Promise<boolean> {
				return true;
			},
			async delete(): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const headers = this.getHeaderData() as Record<string, string | undefined>;
		const credentials = await this.getCredentials('post2allApi');
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];

		const rawBuffer = (request as unknown as { rawBody?: Buffer }).rawBody;
		const eventId = headers['x-post2all-event-id'];
		const timestamp = headers['x-post2all-timestamp'];
		const signature = headers['x-post2all-signature'];

		// An empty secret would make every signature forgeable, so refuse all deliveries without one.
		const signingSecret = String(credentials.signingSecret ?? '').trim();

		const valid =
			signingSecret !== '' &&
			rawBuffer !== undefined &&
			Boolean(eventId && timestamp && signature) &&
			verifyPost2allSignature({
				rawBody: rawBuffer.toString('utf8'),
				secret: signingSecret,
				eventId: eventId as string,
				timestamp: timestamp as string,
				signature: signature as string,
				toleranceSeconds: (options.toleranceSeconds as number | undefined) ?? 300,
			});

		if (!valid) {
			response.status(401).json({ error: 'Invalid post2all webhook signature' });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData() as IDataObject;
		const type = String(body.type ?? '');
		if (events.length > 0 && !events.includes(type)) {
			return { webhookResponse: { ignored: true } };
		}

		if (options.ignoreDuplicates !== false) {
			const staticData = this.getWorkflowStaticData('node') as { recentEventIds?: string[] };
			staticData.recentEventIds ??= [];
			if (isDuplicateEvent(staticData.recentEventIds, eventId as string)) {
				return { webhookResponse: { duplicate: true } };
			}
		}

		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
