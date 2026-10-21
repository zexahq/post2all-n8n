import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Post2allApi implements ICredentialType {
	name = 'post2allApi';

	displayName = 'Post2all API';

	icon: Icon = { light: 'file:../icons/post2all.svg', dark: 'file:../icons/post2all.svg' };

	documentationUrl = 'https://www.post2all.com/docs/api-reference/authentication';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create a key in your post2all workspace under Settings → API Keys',
		},
		{
			displayName: 'Webhook Signing Secret',
			name: 'signingSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Required for the post2all Trigger (deliveries are rejected while it is empty); not used by the post2all node. Shown once when you create the webhook endpoint in the post2all dashboard.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.post2all.com/api/v1',
			description: 'Only change this for a staging or self-managed environment',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://app.post2all.com/api/v1"}}',
			url: '/accounts',
			method: 'GET',
		},
	};
}
