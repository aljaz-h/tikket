import crypto from 'node:crypto';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { DISCORD_EVENTS, WEBHOOK_EVENTS, type HookKind } from '../../shared/constants';
import type { ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { ProjectHook } from '../db/schema';
import { checkUrl, FetchError, privateNetworksAllowed } from '../safe-fetch';
import { decryptSecret, encryptSecret, SecretError } from '../secrets';
import { audit } from '../services/audit';
import { ServiceError } from '../services/users';

export const HOOK_URL_PURPOSE = 'hook:url';
export const HOOK_SECRET_PURPOSE = 'hook:secret';
const MAX_HOOKS_PER_KIND = 10;

/** Integrations are managed by project owners (and administrators) of active projects. */
export function requireIntegrationManager(access: ProjectAccess) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can manage integrations', 'form', 403);
}

const DISCORD_RE =
	/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,30})\/([A-Za-z0-9_-]{20,100})\/?(?:\?thread_id=\d{5,30})?$/;

/** Validates a Discord webhook URL (only Discord's own webhook endpoints are accepted). */
export function parseDiscordUrl(raw: string): string {
	const url = raw.trim();
	if (!DISCORD_RE.test(url))
		throw new ServiceError(
			'Paste a Discord webhook URL, e.g. https://discord.com/api/webhooks/123…/abc… (Channel settings → Integrations → Webhooks).',
			'url'
		);
	return url;
}

/** Validates a generic webhook endpoint with the outbound SSRF policy. */
export function parseWebhookUrl(raw: string): string {
	try {
		const url = checkUrl(raw.trim(), { anyPort: true, allowPrivate: privateNetworksAllowed() });
		if (url.hash) url.hash = '';
		return url.href;
	} catch (err) {
		if (err instanceof FetchError)
			throw new ServiceError(
				err.message === 'That address is not publicly reachable.'
					? 'That address is not publicly reachable. Webhooks can only be sent to public internet addresses.'
					: err.message,
				'url'
			);
		throw err;
	}
}

/** Display form of a stored URL that reveals no credentials (Discord tokens, query strings). */
export function maskUrl(kind: HookKind, url: string): string {
	const u = new URL(url);
	if (kind === 'discord') {
		const id = DISCORD_RE.exec(url)?.[1] ?? '';
		return `${u.host}/api/webhooks/${id.slice(0, 4)}…/••••••••`;
	}
	const path = u.pathname.length > 32 ? `${u.pathname.slice(0, 31)}…` : u.pathname;
	return `${u.protocol}//${u.host}${path === '/' ? '' : path}${u.search ? '?…' : ''}`;
}

export function newSigningSecret() {
	return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

function encrypt(value: string, purpose: string, field: string) {
	try {
		return encryptSecret(value, purpose);
	} catch (err) {
		if (err instanceof SecretError) throw new ServiceError(err.message, field);
		throw err;
	}
}

export const hookInput = z.object({
	name: z.string().trim().min(1, 'Give it a name').max(60, 'At most 60 characters'),
	url: z.string().trim().max(2000).optional(),
	events: z.array(z.string()).max(20),
	enabled: z.boolean()
});
export type HookInput = z.infer<typeof hookInput>;

function cleanEvents(kind: HookKind, events: string[]) {
	const allowed: readonly string[] = kind === 'discord' ? DISCORD_EVENTS : WEBHOOK_EVENTS;
	const clean = [...new Set(events.filter((e) => allowed.includes(e)))];
	if (!clean.length) throw new ServiceError('Choose at least one event', 'events');
	return clean;
}

/** Hooks of a project as the settings page may show them (never the URL or secret). */
export function listHooks(projectId: number, kind?: HookKind) {
	return getDb()
		.select({
			id: schema.projectHooks.id,
			kind: schema.projectHooks.kind,
			name: schema.projectHooks.name,
			urlHint: schema.projectHooks.urlHint,
			events: schema.projectHooks.events,
			enabled: schema.projectHooks.enabled,
			lastSuccessAt: schema.projectHooks.lastSuccessAt,
			lastFailureAt: schema.projectHooks.lastFailureAt,
			lastError: schema.projectHooks.lastError,
			createdAt: schema.projectHooks.createdAt
		})
		.from(schema.projectHooks)
		.where(
			and(
				eq(schema.projectHooks.projectId, projectId),
				kind ? eq(schema.projectHooks.kind, kind) : undefined
			)
		)
		.orderBy(schema.projectHooks.createdAt)
		.all();
}
export type HookListItem = ReturnType<typeof listHooks>[number];

export function getHook(projectId: number, id: number): ProjectHook | undefined {
	return getDb()
		.select()
		.from(schema.projectHooks)
		.where(and(eq(schema.projectHooks.projectId, projectId), eq(schema.projectHooks.id, id)))
		.get();
}

function requireHook(access: ProjectAccess, id: number, kind: HookKind) {
	const hook = getHook(access.project.id, id);
	if (!hook || hook.kind !== kind) throw new ServiceError('Integration not found', 'form', 404);
	return hook;
}

/** Creates a destination. For webhooks, returns the signing secret – shown exactly once. */
export function createHook(
	actorId: number,
	access: ProjectAccess,
	kind: HookKind,
	input: HookInput,
	ip: string | null
): { hook: ProjectHook; secret: string | null } {
	requireIntegrationManager(access);
	if (!input.url) throw new ServiceError('Enter the URL', 'url');
	const url = kind === 'discord' ? parseDiscordUrl(input.url) : parseWebhookUrl(input.url);
	const events = cleanEvents(kind, input.events);
	if (listHooks(access.project.id, kind).length >= MAX_HOOKS_PER_KIND)
		throw new ServiceError(`A project can have at most ${MAX_HOOKS_PER_KIND} of these`, 'form');
	const secret = kind === 'webhook' ? newSigningSecret() : null;
	const hook = getDb()
		.insert(schema.projectHooks)
		.values({
			projectId: access.project.id,
			kind,
			name: input.name,
			urlEnc: encrypt(url, HOOK_URL_PURPOSE, 'url'),
			urlHint: maskUrl(kind, url),
			secretEnc: secret ? encrypt(secret, HOOK_SECRET_PURPOSE, 'form') : null,
			events,
			enabled: input.enabled,
			createdById: actorId
		})
		.returning()
		.get();
	audit({
		actorId,
		action: kind === 'discord' ? 'integration.discord_created' : 'integration.webhook_created',
		targetType: 'project',
		targetId: access.project.id,
		data: { hookId: hook.id, name: hook.name, destination: hook.urlHint, events },
		ip
	});
	return { hook, secret };
}

/** Updates name, events and state; a non-empty URL replaces the stored one. */
export function updateHook(
	actorId: number,
	access: ProjectAccess,
	kind: HookKind,
	id: number,
	input: HookInput,
	ip: string | null
) {
	requireIntegrationManager(access);
	const hook = requireHook(access, id, kind);
	const events = cleanEvents(kind, input.events);
	const patch: Partial<ProjectHook> = {
		name: input.name,
		events,
		enabled: input.enabled,
		updatedAt: new Date()
	};
	if (input.url) {
		const url = kind === 'discord' ? parseDiscordUrl(input.url) : parseWebhookUrl(input.url);
		patch.urlEnc = encrypt(url, HOOK_URL_PURPOSE, 'url');
		patch.urlHint = maskUrl(kind, url);
		patch.lastError = null;
	}
	getDb().update(schema.projectHooks).set(patch).where(eq(schema.projectHooks.id, hook.id)).run();
	audit({
		actorId,
		action: kind === 'discord' ? 'integration.discord_updated' : 'integration.webhook_updated',
		targetType: 'project',
		targetId: access.project.id,
		data: {
			hookId: hook.id,
			name: input.name,
			enabled: input.enabled,
			events,
			urlReplaced: !!input.url
		},
		ip
	});
}

export function rotateHookSecret(
	actorId: number,
	access: ProjectAccess,
	id: number,
	ip: string | null
): string {
	requireIntegrationManager(access);
	const hook = requireHook(access, id, 'webhook');
	const secret = newSigningSecret();
	getDb()
		.update(schema.projectHooks)
		.set({ secretEnc: encrypt(secret, HOOK_SECRET_PURPOSE, 'form'), updatedAt: new Date() })
		.where(eq(schema.projectHooks.id, hook.id))
		.run();
	audit({
		actorId,
		action: 'integration.webhook_secret_rotated',
		targetType: 'project',
		targetId: access.project.id,
		data: { hookId: hook.id, name: hook.name },
		ip
	});
	return secret;
}

export function deleteHook(
	actorId: number,
	access: ProjectAccess,
	kind: HookKind,
	id: number,
	ip: string | null
) {
	requireIntegrationManager(access);
	const hook = requireHook(access, id, kind);
	// Pending deliveries and the delivery history go with it (ON DELETE CASCADE).
	getDb().delete(schema.projectHooks).where(eq(schema.projectHooks.id, hook.id)).run();
	audit({
		actorId,
		action: kind === 'discord' ? 'integration.discord_deleted' : 'integration.webhook_deleted',
		targetType: 'project',
		targetId: access.project.id,
		data: { hookId: hook.id, name: hook.name, destination: hook.urlHint },
		ip
	});
}

/** Decrypted destination and signing secret – only for the delivery worker. */
export function hookCredentials(hook: ProjectHook) {
	return {
		url: decryptSecret(hook.urlEnc, HOOK_URL_PURPOSE),
		secret: hook.secretEnc ? decryptSecret(hook.secretEnc, HOOK_SECRET_PURPOSE) : null
	};
}

export function recentDeliveries(hookIds: number[], perHook = 15) {
	if (!hookIds.length) return [];
	return getDb()
		.select()
		.from(schema.hookDeliveries)
		.where(inArray(schema.hookDeliveries.hookId, hookIds))
		.orderBy(desc(schema.hookDeliveries.id))
		.limit(perHook * hookIds.length)
		.all();
}

/** Keeps the newest `keep` deliveries of a hook. */
export function pruneDeliveries(hookId: number, keep = 50) {
	const db = getDb();
	const newest = db
		.select({ id: schema.hookDeliveries.id })
		.from(schema.hookDeliveries)
		.where(eq(schema.hookDeliveries.hookId, hookId))
		.orderBy(desc(schema.hookDeliveries.id))
		.limit(keep)
		.all()
		.map((r) => r.id);
	if (newest.length < keep) return;
	db.delete(schema.hookDeliveries)
		.where(
			and(eq(schema.hookDeliveries.hookId, hookId), notInArray(schema.hookDeliveries.id, newest))
		)
		.run();
}
