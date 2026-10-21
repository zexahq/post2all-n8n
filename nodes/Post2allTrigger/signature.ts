import { createHmac, timingSafeEqual } from 'crypto';

export type SignatureInput = {
	rawBody: string;
	secret: string;
	eventId: string;
	timestamp: string;
	signature: string;
	toleranceSeconds?: number;
	nowMs?: number;
};

/**
 * Verifies a post2all webhook delivery. The signed value is `${eventId}.${timestamp}.${rawBody}`,
 * HMAC-SHA256 with the endpoint secret, sent as `v1=<hex>`. Stale timestamps are rejected.
 */
export function verifyPost2allSignature(input: SignatureInput): boolean {
	const timestamp = Number(input.timestamp);
	const tolerance = input.toleranceSeconds ?? 300;
	const nowSeconds = (input.nowMs ?? Date.now()) / 1000;
	if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) return false;

	const expected = `v1=${createHmac('sha256', input.secret)
		.update(`${input.eventId}.${input.timestamp}.${input.rawBody}`)
		.digest('hex')}`;
	const expectedBytes = Buffer.from(expected);
	const actualBytes = Buffer.from(input.signature);
	return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export const RECENT_EVENT_LIMIT = 200;

/** Returns true when the event ID was already seen, otherwise records it (bounded history). */
export function isDuplicateEvent(seen: string[], eventId: string): boolean {
	if (seen.includes(eventId)) return true;
	seen.push(eventId);
	if (seen.length > RECENT_EVENT_LIMIT) seen.splice(0, seen.length - RECENT_EVENT_LIMIT);
	return false;
}
