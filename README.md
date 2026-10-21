# n8n-nodes-post2all

[n8n](https://n8n.io) community node for [post2all](https://www.post2all.com): create, schedule, and publish social media posts, manage connected accounts, and start workflows when posts publish or fail.

## Installation

In n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-post2all`. See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

## Credentials

Create an API key in your post2all workspace under **Settings → API Keys**, then add a **Post2all API** credential in n8n.

| Field                  | Notes                                         |
| ---------------------- | --------------------------------------------- |
| API Key                | Sent as the `x-api-key` header                |
| Webhook Signing Secret | Only needed for the post2all Trigger          |
| Base URL               | Defaults to `https://app.post2all.com/api/v1` |

Standard workspace keys allow 1,000 requests per rolling 24 hours, so prefer the Trigger node over polling.

## post2all node

| Resource | Operations                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Post     | Create, Update, Get, Get Many, Get Analytics, Cancel, Retry, Delete, Delete Published                   |
| Account  | Get, Get Many, Get Analytics, Get Publishing Schema, Get Publishing Options, List Platforms, Disconnect |
| Media    | Upload From URL, Upload From Binary                                                                     |
| Profile  | Get Many                                                                                                |

The node can also be used as a tool by n8n AI agents.

### Creating a post

1. Add one or more **Targets**. Pick an account from the list; the platform is filled in automatically.
2. Put platform-specific fields in the target's **Settings (JSON)**, for example `{"caption": "LinkedIn copy"}`. Run **Account → Get Publishing Schema** to see the limits, fields, and fixed choices each account accepts. Account-dependent values, such as Discord channels, come from **Get Publishing Options**.
3. Optionally attach **Media** from a public HTTPS URL, an existing media ID, or binary data from an earlier node.
4. Choose **Delivery**: Draft, Publish Now, or Schedule. A scheduled time without an offset is read in the workflow timezone.

Post type is inferred from the attached media. **Post → Delete Published** removes the live post from one platform and needs the post target ID (from **Post → Get**); it works only on platforms where deletion is supported. Unknown or invalid settings are rejected by the API and shown as the node error.

**Retries are safe.** Every create request carries an idempotency key derived from the workflow, execution, and item, so n8n's _Retry On Fail_ cannot publish the same post twice. Set your own key under **Options** to deduplicate across executions.

### Example: publish new blog posts

RSS Feed Trigger → post2all (Post → Create) with Content set to `{{ $json.title }} {{ $json.link }}`, one target per account, and Delivery set to Schedule.

## post2all Trigger node

Starts a workflow for post, account, and billing events, for example **Post Completed**, **Post Failed**, or **Post Target Published**.

1. Add the trigger and copy its **Production URL** (or **Test URL** while building).
2. In the post2all dashboard, open **Webhooks**, create an endpoint with that URL, and subscribe it to the same events. Webhook endpoints are managed in the dashboard only.
3. Copy the signing secret, shown once, into the credential's **Webhook Signing Secret**. This is required: the trigger rejects every delivery with a `401` while the secret is empty.

Every delivery is verified against its HMAC-SHA256 signature and timestamp before the workflow runs; invalid deliveries get a `401`. post2all delivers at least once, so duplicate event IDs are skipped by default. Webhooks are available on workspaces whose plan includes them; see the [webhooks documentation](https://www.post2all.com/docs/webhooks).

## Development

```bash
npm install
npm run lint
npm test        # builds, then runs the unit tests
npm run dev     # starts a local n8n with the node loaded
```

Releases are published from GitHub Actions with npm provenance (`publish.yml`).

## License

[MIT](LICENSE.md)
