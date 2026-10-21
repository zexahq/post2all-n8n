import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'post2allApi';
export const DEFAULT_BASE_URL = 'https://app.post2all.com/api/v1';
export const PROFILE_HEADER = 'x-profile-id';

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;

export type Post2allRequestOptions = {
	body?: IDataObject;
	qs?: IDataObject;
	profileId?: string;
	idempotencyKey?: string;
};

/**
 * Calls the post2all REST API with the stored credential. The API key is attached by the
 * credential's `authenticate` block; the base URL is read from the credential so self-hosted
 * or staging environments work.
 */
export async function post2allApiRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: Post2allRequestOptions = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const baseUrl = resolveBaseUrl(credentials.baseUrl as string | undefined);

	const headers: IDataObject = {};
	if (options.profileId) headers[PROFILE_HEADER] = options.profileId;
	if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		headers,
		json: true,
	};
	if (options.body && Object.keys(options.body).length > 0) request.body = options.body;
	if (options.qs && Object.keys(options.qs).length > 0) request.qs = options.qs;

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			request,
		)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as never, {
			message: describeApiError(error),
		});
	}
}

export function resolveBaseUrl(value: string | undefined): string {
	const trimmed = (value ?? '').trim().replace(/\/+$/, '');
	return trimmed.length > 0 ? trimmed : DEFAULT_BASE_URL;
}

/** Prefers the API's own error message and adds the retry hint for rate limits. */
export function describeApiError(error: unknown): string {
	const candidate = error as {
		message?: string;
		httpCode?: string;
		response?: { headers?: Record<string, string> };
		cause?: { response?: { data?: unknown; body?: unknown; headers?: Record<string, string> } };
	};
	const body = (candidate.cause?.response?.data ?? candidate.cause?.response?.body) as
		| { error?: { code?: string; message?: string } }
		| undefined;
	const apiMessage = body?.error?.message;
	const apiCode = body?.error?.code;
	const base = apiMessage
		? apiCode
			? `${apiCode}: ${apiMessage}`
			: apiMessage
		: (candidate.message ?? 'post2all request failed');

	if (candidate.httpCode === '429' || apiCode === 'RATE_LIMITED') {
		const retryAfter =
			candidate.cause?.response?.headers?.['retry-after'] ??
			candidate.response?.headers?.['retry-after'];
		return retryAfter ? `${base} (retry after ${retryAfter} seconds)` : base;
	}
	return base;
}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

function offsetMinutes(timeZone: string, at: Date): number {
	const format = new Intl.DateTimeFormat('en-US', {
		timeZone,
		timeZoneName: 'longOffset',
	} as unknown as Intl.DateTimeFormatOptions);
	const zone = format.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value;
	const match = zone ? /GMT([+-])(\d{2}):?(\d{2})?/.exec(zone) : null;
	if (!match) return 0;
	const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
	return match[1] === '-' ? -minutes : minutes;
}

function formatOffset(minutes: number): string {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return `${sign}${hh}:${mm}`;
}

/**
 * post2all requires a timezone offset on `scheduledAt`. n8n's date picker produces a wall-clock
 * time without one, so interpret it in the workflow timezone. Values that already carry an
 * offset or `Z` are returned untouched.
 */
export function toOffsetDateTime(value: string, timeZone: string): string {
	const text = value.trim();
	if (OFFSET_SUFFIX.test(text)) return text;
	const match = WALL_TIME.exec(text);
	if (!match) return text;

	const [, year, month, day, hour, minute, second = '00'] = match;
	const wall = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
	let zone = timeZone;
	try {
		offsetMinutes(zone, new Date());
	} catch {
		zone = 'UTC';
	}
	const guess = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	);
	let offset = offsetMinutes(zone, new Date(guess));
	const corrected = offsetMinutes(zone, new Date(guess - offset * 60_000));
	if (corrected !== offset) offset = corrected;
	return `${wall}${formatOffset(offset)}`;
}

export function parseJsonObject(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') return {};
	if (typeof value === 'object' && !Array.isArray(value)) return value as IDataObject;
	if (typeof value !== 'string') {
		throw new NodeOperationError(context.getNode(), `${fieldName} must be a JSON object`, {
			itemIndex,
		});
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
			return parsed as IDataObject;
	} catch {
		// fall through to the shared error below
	}
	throw new NodeOperationError(context.getNode(), `${fieldName} must be a valid JSON object`, {
		itemIndex,
	});
}

/** A deterministic key so a retried execution cannot publish the same post twice. */
export function buildIdempotencyKey(parts: Array<string | number | undefined>): string {
	return `n8n-${parts.filter((part) => part !== undefined && part !== '').join('-')}`
		.replace(/[^\x21-\x7e]/g, '-')
		.slice(0, 255);
}
