import type { RequestEvent } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ApiScope } from '../../shared/constants';
import { accessForProject, findProjectByKey, type ProjectAccess } from '../authz';
import { RateLimiter } from '../auth/rate-limit';
import { ServiceError } from '../services/users';
import { authenticateToken, type ApiAuth, type AuthFailure } from './tokens';

/**
 * Shared plumbing of the public REST API (/api/v1): bearer-token authentication, scope checks,
 * API-specific rate limits and a stable JSON shape:
 *   success  { "data": …, "meta": { … } }
 *   error    { "error": { "code": "ticket_not_found", "message": "Ticket not found" } }
 * Internal errors never expose stack traces (a request id is returned for the logs instead).
 */

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>
	) {
		super(message);
	}
}

const minute = 60 * 1000;
const perMinute = (name: string, fallback: number) => {
	const n = Number(process.env[name]);
	return Number.isInteger(n) && n > 0 ? n : fallback;
};
/** Generous enough for CI and bots, small enough to stop runaway scripts. */
export const apiLimits = {
	get read() {
		return perMinute('API_RATE_LIMIT', 300);
	},
	get write() {
		return Math.max(1, Math.floor(perMinute('API_RATE_LIMIT', 300) / 5));
	}
};
const limiters = {
	read: new RateLimiter(apiLimits.read, minute),
	write: new RateLimiter(apiLimits.write, minute),
	/** Failed authentication per client IP. */
	auth: new RateLimiter(30, minute)
};
export function resetApiLimiters() {
	limiters.read = new RateLimiter(apiLimits.read, minute);
	limiters.write = new RateLimiter(apiLimits.write, minute);
	limiters.auth = new RateLimiter(30, minute);
}

export interface ScopeRule {
	/** Scope a personal token needs (undefined = not available to personal tokens). */
	personal?: ApiScope | 'any';
	/** Scope a project token needs (undefined = not available to project tokens). */
	project?: ApiScope | 'any';
}

export interface ApiContext {
	event: RequestEvent;
	auth: ApiAuth;
	headers: Headers;
}

const AUTH_MESSAGES: Record<AuthFailure, [number, string, string]> = {
	missing: [401, 'unauthenticated', 'Send an API token: Authorization: Bearer <token>'],
	malformed: [401, 'invalid_token', 'The API token is malformed'],
	invalid: [401, 'invalid_token', 'The API token is not valid'],
	expired: [401, 'token_expired', 'The API token has expired'],
	revoked: [401, 'token_revoked', 'The API token was revoked'],
	inactive: [401, 'token_inactive', 'The account or project behind this token is no longer active']
};

export function json(body: unknown, status = 200, headers?: Headers) {
	const h = new Headers(headers);
	h.set('content-type', 'application/json; charset=utf-8');
	h.set('cache-control', 'no-store');
	h.set('x-content-type-options', 'nosniff');
	return new Response(JSON.stringify(body), { status, headers: h });
}

export const ok = (
	data: unknown,
	meta: Record<string, unknown> = {},
	status = 200,
	headers?: Headers
) => json({ data, meta }, status, headers);

function errorResponse(err: ApiError, headers?: Headers) {
	return json(
		{
			error: {
				code: err.code,
				message: err.message,
				...(err.details ? { details: err.details } : {})
			}
		},
		err.status,
		headers
	);
}

function rateHeaders(headers: Headers, limit: number, remaining: number, resetMs: number) {
	headers.set('x-ratelimit-limit', String(limit));
	headers.set('x-ratelimit-remaining', String(Math.max(0, remaining)));
	headers.set('x-ratelimit-reset', String(Math.ceil(resetMs / 1000)));
}

export function hasScope(auth: ApiAuth, rule: ScopeRule) {
	const needed = auth.kind === 'personal' ? rule.personal : rule.project;
	if (!needed) return false;
	return needed === 'any' || auth.scopes.includes(needed);
}

/** Maps domain errors to API errors. */
export function toApiError(err: unknown): ApiError {
	if (err instanceof ApiError) return err;
	if (err instanceof ServiceError) {
		const status =
			err.status === 403 ? 403 : err.status === 404 ? 404 : err.status === 409 ? 409 : 422;
		const code =
			status === 403
				? 'forbidden'
				: status === 404
					? 'not_found'
					: status === 409
						? 'conflict'
						: 'validation_failed';
		return new ApiError(
			status,
			code,
			err.message,
			err.field && err.field !== 'form' ? { field: err.field } : undefined
		);
	}
	if (err instanceof z.ZodError)
		return new ApiError(422, 'validation_failed', err.issues[0]?.message ?? 'Invalid request', {
			field: err.issues[0]?.path.join('.')
		});
	if (err instanceof SyntaxError)
		return new ApiError(400, 'invalid_json', 'The request body is not valid JSON');
	const id = randomUUID();
	console.error(`[tikket] api ${id}`, err);
	return new ApiError(500, 'internal_error', `Something went wrong (request ${id})`);
}

/**
 * Wraps an API handler: authenticates the bearer token, enforces the scope, applies rate limits
 * and converts every error into the JSON error shape.
 */
export function apiHandler(
	rule: ScopeRule,
	opts: { write?: boolean },
	fn: (ctx: ApiContext) => Promise<Response> | Response
) {
	return async (event: RequestEvent): Promise<Response> => {
		const headers = new Headers();
		const ip = event.locals.clientIp ?? 'unknown';
		try {
			if (limiters.auth.check(`ip:${ip}`))
				throw new ApiError(429, 'rate_limited', 'Too many failed authentication attempts');
			const auth = authenticateToken(event.request.headers.get('authorization'));
			if (typeof auth === 'string') {
				limiters.auth.hit(`ip:${ip}`);
				const [status, code, message] = AUTH_MESSAGES[auth];
				headers.set('www-authenticate', 'Bearer realm="tikket"');
				throw new ApiError(status, code, message);
			}
			const limiter = opts.write ? limiters.write : limiters.read;
			const limit = opts.write ? apiLimits.write : apiLimits.read;
			const key = `token:${auth.tokenId}`;
			const wait = limiter.hit(key);
			const remaining = limit - limiter.count(key);
			rateHeaders(headers, limit, remaining, wait || limiter.resetIn(key));
			if (wait) {
				headers.set('retry-after', String(Math.ceil(wait / 1000)));
				throw new ApiError(429, 'rate_limited', 'Too many requests – slow down');
			}
			if (!hasScope(auth, rule))
				throw new ApiError(
					403,
					'insufficient_scope',
					`This token lacks the scope needed here (${auth.kind === 'personal' ? (rule.personal ?? 'not available to personal tokens') : (rule.project ?? 'not available to project tokens')})`
				);
			const res = await fn({ event, auth, headers });
			for (const [k, v] of headers) if (!res.headers.has(k)) res.headers.set(k, v);
			return res;
		} catch (err) {
			return errorResponse(toApiError(err), headers);
		}
	};
}

/**
 * Resolves a project for the token. Projects the token cannot see answer 404 – exactly like
 * projects that don't exist – so keys of private projects are not revealed.
 */
export function projectAccess(auth: ApiAuth, key: string): ProjectAccess {
	const notFound = new ApiError(404, 'project_not_found', 'Project not found');
	const project = findProjectByKey(key.toUpperCase());
	if (!project) throw notFound;
	if (auth.project && auth.project.id !== project.id) throw notFound;
	const access = accessForProject(auth.user, project);
	if (!access.canView) throw notFound;
	return access;
}

export async function readJson(event: RequestEvent, maxBytes = 256 * 1024): Promise<unknown> {
	const type = event.request.headers.get('content-type') ?? '';
	if (!/application\/json/i.test(type))
		throw new ApiError(415, 'unsupported_media_type', 'Send JSON (Content-Type: application/json)');
	const text = await event.request.text();
	if (text.length > maxBytes)
		throw new ApiError(413, 'payload_too_large', 'The request body is too large');
	return JSON.parse(text);
}

// ── Cursor pagination ──────────────────────────────────────────────────────

export const MAX_LIMIT = 100;

export function pageParams(url: URL, fallback = 25) {
	const raw = url.searchParams.get('limit');
	const limit = raw === null ? fallback : Number(raw);
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
		throw new ApiError(400, 'invalid_limit', `limit must be between 1 and ${MAX_LIMIT}`);
	const cursor = url.searchParams.get('cursor');
	let before: number | null = null;
	if (cursor) {
		try {
			const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
				id?: unknown;
			};
			if (!Number.isInteger(parsed.id)) throw new Error('bad');
			before = parsed.id as number;
		} catch {
			throw new ApiError(400, 'invalid_cursor', 'The cursor is not valid');
		}
	}
	return { limit, before };
}

export const encodeCursor = (id: number) =>
	Buffer.from(JSON.stringify({ id })).toString('base64url');
