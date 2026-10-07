import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { OutboundJob, ProjectHook } from '../db/schema';
import { DeliveryError, registerHandler } from '../outbound/queue';
import { FetchError, privateNetworksAllowed, safeRequest, type Resolver } from '../safe-fetch';
import { SecretError } from '../secrets';
import { buildEnvelope, type Envelope } from './events';
import { hookCredentials, pruneDeliveries } from './hooks';

let timeoutMs = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Test seam: DNS resolver used for deliveries. */
let resolver: Resolver | undefined;
export function setDeliveryResolver(fn: Resolver | undefined) {
	resolver = fn;
}
/** Test seam: request timeout for deliveries (default 10 s). */
export function setDeliveryTimeout(ms = 10_000) {
	timeoutMs = ms;
}

/**
 * Signature of a webhook body: HMAC-SHA256 over `${timestamp}.${body}` with the signing secret,
 * hex encoded, sent as `Tikket-Signature: v1=<hex>`. See docs/webhooks.md for verification.
 */
export function signPayload(secret: string, timestamp: number, body: string) {
	return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Short printable excerpt of an error or response body (no control characters). */
export function excerpt(value: string, max = 200) {
	const clean = value
		// eslint-disable-next-line no-control-regex -- stripping control characters is the point
		.replace(/[\u0000-\u001f\u007f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function retryAfterMs(header: string | string[] | undefined): number | undefined {
	const raw = Array.isArray(header) ? header[0] : header;
	if (!raw) return undefined;
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(raw);
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface AttemptResult {
	ok: boolean;
	statusCode: number | null;
	durationMs: number;
	error: string | null;
	retryable: boolean;
	retryAfterMs?: number;
}

/** Sends one request to a destination and classifies the outcome. Never throws. */
export async function attemptDelivery(
	hook: ProjectHook,
	body: string,
	headers: Record<string, string>
): Promise<AttemptResult> {
	const started = Date.now();
	let url: string;
	try {
		url = hookCredentials(hook).url;
	} catch (err) {
		return {
			ok: false,
			statusCode: null,
			durationMs: 0,
			retryable: false,
			error: err instanceof SecretError ? err.message : 'The destination could not be read.'
		};
	}
	try {
		const res = await safeRequest(url, {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json', ...headers },
			accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
			maxBytes: MAX_RESPONSE_BYTES,
			timeoutMs,
			anyPort: hook.kind === 'webhook',
			allowPrivate: hook.kind === 'webhook' && privateNetworksAllowed(),
			resolve: resolver
		});
		const durationMs = Date.now() - started;
		if (res.status >= 200 && res.status < 300)
			return { ok: true, statusCode: res.status, durationMs, error: null, retryable: false };
		const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
		const detail = excerpt(res.body.toString('utf8'), 160);
		return {
			ok: false,
			statusCode: res.status,
			durationMs,
			retryable,
			retryAfterMs: res.status === 429 ? retryAfterMs(res.headers['retry-after']) : undefined,
			error:
				res.status >= 300 && res.status < 400
					? `HTTP ${res.status}: redirects are not followed`
					: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Delivery failed';
		// Policy rejections (private address, bad scheme) are permanent; network trouble is not.
		const permanent =
			err instanceof FetchError &&
			/not publicly reachable|private or reserved|Only http|credentials|standard web ports|not a valid/.test(
				message
			);
		return {
			ok: false,
			statusCode: null,
			durationMs: Date.now() - started,
			retryable: !permanent,
			error: excerpt(message)
		};
	}
}

function record(
	hook: ProjectHook,
	jobId: number | null,
	event: string,
	eventId: string,
	attempt: number,
	result: AttemptResult
) {
	const db = getDb();
	db.insert(schema.hookDeliveries)
		.values({
			hookId: hook.id,
			jobId,
			event,
			eventId,
			attempt,
			statusCode: result.statusCode,
			durationMs: result.durationMs,
			success: result.ok,
			error: result.error
		})
		.run();
	db.update(schema.projectHooks)
		.set(
			result.ok
				? { lastSuccessAt: new Date() }
				: { lastFailureAt: new Date(), lastError: result.error }
		)
		.where(eq(schema.projectHooks.id, hook.id))
		.run();
	pruneDeliveries(hook.id);
}

function webhookRequest(hook: ProjectHook, envelope: Envelope, attempt: number) {
	const body = JSON.stringify(envelope);
	const timestamp = Math.floor(Date.now() / 1000);
	let secret: string | null;
	try {
		secret = hookCredentials(hook).secret;
	} catch {
		secret = null;
	}
	const headers: Record<string, string> = {
		'user-agent': 'Tikket-Webhooks/1',
		'tikket-event': envelope.event,
		'tikket-delivery': envelope.id,
		'tikket-timestamp': String(timestamp),
		'tikket-attempt': String(attempt)
	};
	if (secret) headers['tikket-signature'] = `v1=${signPayload(secret, timestamp, body)}`;
	return { body, headers };
}

async function deliverJob(job: OutboundJob) {
	if (!job.hookId) return;
	const hook = getDb()
		.select()
		.from(schema.projectHooks)
		.where(eq(schema.projectHooks.id, job.hookId))
		.get();
	// Deleted or disabled since the event: nothing to deliver.
	if (!hook || !hook.enabled) return;
	let body: string;
	let headers: Record<string, string>;
	let event: string;
	let eventId: string;
	if (job.kind === 'webhook') {
		const envelope = job.payload.envelope as Envelope;
		({ body, headers } = webhookRequest(hook, envelope, job.attempts));
		event = envelope.event;
		eventId = envelope.id;
	} else {
		body = JSON.stringify(job.payload.message);
		headers = { 'user-agent': 'Tikket (+https://github.com/aljaz-h/tikket)' };
		event = String(job.payload.event);
		eventId = String(job.payload.eventId);
	}
	const result = await attemptDelivery(hook, body, headers);
	record(hook, job.id, event, eventId, job.attempts, result);
	if (!result.ok)
		throw new DeliveryError(
			result.error ?? 'Delivery failed',
			result.retryable,
			result.retryAfterMs
		);
}

registerHandler('webhook', deliverJob);
registerHandler('discord', deliverJob);

/** Sends a test event right away (not queued) and records it in the history. */
export async function sendTestDelivery(
	hook: ProjectHook,
	project: { id: number; key: string; name: string },
	appName = 'Tikket'
): Promise<AttemptResult> {
	let body: string;
	let headers: Record<string, string>;
	let eventId: string;
	if (hook.kind === 'webhook') {
		const envelope = buildEnvelope(project, 'ping', {
			message: 'This is a test event from Tikket. Your endpoint is receiving webhooks.'
		});
		({ body, headers } = webhookRequest(hook, envelope, 1));
		eventId = envelope.id;
	} else {
		eventId = `evt_test_${Date.now()}`;
		body = JSON.stringify({
			username: appName,
			allowed_mentions: { parse: [] },
			embeds: [
				{
					author: { name: `${appName} — Test message` },
					title: `${project.name} is connected`,
					description: 'Discord notifications for this project will appear in this channel.',
					color: 0xb8f779,
					footer: { text: `${project.name} (${project.key})` },
					timestamp: new Date().toISOString()
				}
			]
		});
		headers = {};
	}
	const result = await attemptDelivery(hook, body, headers);
	record(hook, null, hook.kind === 'webhook' ? 'ping' : 'test', eventId, 1, result);
	return result;
}
