# Changelog

## Unreleased

- **Breaking:** removed the Tags field (create/update) and the Tag filter (Get Many); post2all no longer supports post tags and rejects requests that include them.
- **Security:** the post2all Trigger now rejects every delivery (401, no workflow run) when the credential's Webhook Signing Secret is empty. Previously deliveries were verified against an empty secret and could be forged.
- Errors from the post2all API now keep their descriptive message instead of being re-wrapped.
- Target accounts are looked up once per execution instead of once per item, saving API calls.
- The account dropdown now respects the selected profile.
- Pinned `@n8n/node-cli` to 0.52.5.
- New operations: Post → Delete Published, Post → Get Analytics, Account → Get Analytics, Account → Disconnect, Account → List Platforms.

## 0.1.0

- Initial release.
- **post2all** node: create, update, get, list, cancel, retry, and delete posts; list and inspect connected accounts; fetch the publishing schema and dynamic publishing options; upload media from a URL or binary data; list profiles.
- **post2all Trigger** node: starts a workflow on post, account, and billing events, with signature verification and duplicate-delivery protection.
