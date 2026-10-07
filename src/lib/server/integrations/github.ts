import crypto from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { MERGE_ACTIONS, type DevLinkKind, type MergeAction } from '../../shared/constants';
import type { ProjectAccess } from '../authz';
import { findProjectById } from '../authz';
import { randomId, safeEqual } from '../auth/tokens';
import { getDb, schema } from '../db';
import type { GithubConnection, Ticket } from '../db/schema';
import { FetchError, safeFetch, type Resolver } from '../safe-fetch';
import { decryptSecret, encryptSecret, SecretError } from '../secrets';
import { audit } from '../services/audit';
import { setStatusBySystem } from '../services/tickets';
import { ServiceError } from '../services/users';
import { requireIntegrationManager } from './hooks';

/**
 * GitHub integration: links pull requests and commits to tickets.
 *
 * Model: a repository webhook (configured by the project owner on GitHub) sends `push` and
 * `pull_request` events to a per-connection URL. Every delivery is authenticated with the
 * webhook secret (X-Hub-Signature-256, HMAC-SHA256), checked against the connected repository
 * and recorded by delivery id so replays are ignored. Ticket keys of the connected project
 * (e.g. SPL-42) in commit messages and PR titles/descriptions create the links.
 *
 * A token is optional: it is only used to test the connection and to read titles of manually
 * added references in private repositories. No GitHub data is fetched when tickets are viewed.
 */

export const GITHUB_SECRET_PURPOSE = 'github:webhook';
export const GITHUB_TOKEN_PURPOSE = 'github:token';
const API = 'https://api.github.com';

/** Test seam: DNS resolver for GitHub API calls. */
let resolver: Resolver | undefined;
export function setGithubResolver(fn: Resolver | undefined) {
	resolver = fn;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts "owner/repo", a github.com URL or a clone URL. */
export function parseRepository(raw: string): { owner: string; repo: string } {
	const value = raw
		.trim()
		.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
		.replace(/^git@github\.com:/i, '')
		.replace(/\.git$/i, '')
		.replace(/\/+$/, '');
	const [owner, repo, ...rest] = value.split('/');
	if (
		!owner ||
		!repo ||
		rest.length ||
		!OWNER_RE.test(owner) ||
		!REPO_RE.test(repo) ||
		repo === '.' ||
		repo === '..'
	)
		throw new ServiceError(
			'Enter the repository as owner/name, e.g. aljaz-h/spool-tracker',
			'repository'
		);
	return { owner, repo };
}

function encrypt(value: string, purpose: string, field: string) {
	try {
		return encryptSecret(value, purpose);
	} catch (err) {
		if (err instanceof SecretError) throw new ServiceError(err.message, field);
		throw err;
	}
}

export function getConnection(projectId: number): GithubConnection | undefined {
	return getDb()
		.select()
		.from(schema.githubConnections)
		.where(eq(schema.githubConnections.projectId, projectId))
		.orderBy(schema.githubConnections.id)
		.get();
}

/** Connection details safe for the settings page (no secrets). */
export function connectionForDisplay(conn: GithubConnection | undefined) {
	if (!conn) return null;
	return {
		id: conn.id,
		publicId: conn.publicId,
		owner: conn.owner,
		repo: conn.repo,
		repoId: conn.repoId,
		hasToken: !!conn.tokenEnc,
		mergeAction: conn.mergeAction,
		lastEventAt: conn.lastEventAt,
		lastEventType: conn.lastEventType,
		lastErrorAt: conn.lastErrorAt,
		lastError: conn.lastError,
		createdAt: conn.createdAt
	};
}

export const connectInput = z.object({
	repository: z.string().max(300),
	token: z.string().trim().max(400).optional(),
	mergeAction: z.enum(MERGE_ACTIONS).default('none')
});

function newWebhookSecret() {
	return crypto.randomBytes(32).toString('hex');
}

/** Connects a repository. Returns the webhook secret, which is shown exactly once. */
export function connectRepository(
	actorId: number,
	access: ProjectAccess,
	input: z.infer<typeof connectInput>,
	ip: string | null
) {
	requireIntegrationManager(access);
	if (getConnection(access.project.id))
		throw new ServiceError('This project is already connected to a repository', 'form', 409);
	const { owner, repo } = parseRepository(input.repository);
	const secret = newWebhookSecret();
	const conn = getDb()
		.insert(schema.githubConnections)
		.values({
			publicId: randomId(18),
			projectId: access.project.id,
			owner,
			repo,
			webhookSecretEnc: encrypt(secret, GITHUB_SECRET_PURPOSE, 'form'),
			tokenEnc: input.token ? encrypt(input.token, GITHUB_TOKEN_PURPOSE, 'token') : null,
			mergeAction: input.mergeAction,
			createdById: actorId
		})
		.returning()
		.get();
	audit({
		actorId,
		action: 'integration.github_connected',
		targetType: 'project',
		targetId: access.project.id,
		data: { repository: `${owner}/${repo}`, token: !!input.token, mergeAction: input.mergeAction },
		ip
	});
	return { connection: conn, secret };
}

export function updateConnection(
	actorId: number,
	access: ProjectAccess,
	input: { mergeAction: MergeAction; token?: string; clearToken?: boolean },
	ip: string | null
) {
	requireIntegrationManager(access);
	const conn = getConnection(access.project.id);
	if (!conn) throw new ServiceError('No repository is connected', 'form', 404);
	const patch: Partial<GithubConnection> = {
		mergeAction: input.mergeAction,
		updatedAt: new Date()
	};
	if (input.clearToken) patch.tokenEnc = null;
	else if (input.token) patch.tokenEnc = encrypt(input.token, GITHUB_TOKEN_PURPOSE, 'token');
	getDb()
		.update(schema.githubConnections)
		.set(patch)
		.where(eq(schema.githubConnections.id, conn.id))
		.run();
	audit({
		actorId,
		action: 'integration.github_updated',
		targetType: 'project',
		targetId: access.project.id,
		data: {
			mergeAction: input.mergeAction,
			token: input.clearToken ? 'cleared' : input.token ? 'replaced' : 'kept'
		},
		ip
	});
}

export function regenerateWebhookSecret(actorId: number, access: ProjectAccess, ip: string | null) {
	requireIntegrationManager(access);
	const conn = getConnection(access.project.id);
	if (!conn) throw new ServiceError('No repository is connected', 'form', 404);
	const secret = newWebhookSecret();
	getDb()
		.update(schema.githubConnections)
		.set({
			webhookSecretEnc: encrypt(secret, GITHUB_SECRET_PURPOSE, 'form'),
			updatedAt: new Date()
		})
		.where(eq(schema.githubConnections.id, conn.id))
		.run();
	audit({
		actorId,
		action: 'integration.github_updated',
		targetType: 'project',
		targetId: access.project.id,
		data: { webhookSecret: 'regenerated' },
		ip
	});
	return secret;
}

/** Disconnects the repository. Its development references are removed with it. */
export function disconnectRepository(actorId: number, access: ProjectAccess, ip: string | null) {
	requireIntegrationManager(access);
	const conn = getConnection(access.project.id);
	if (!conn) return;
	getDb().delete(schema.githubConnections).where(eq(schema.githubConnections.id, conn.id)).run();
	audit({
		actorId,
		action: 'integration.github_disconnected',
		targetType: 'project',
		targetId: access.project.id,
		data: { repository: `${conn.owner}/${conn.repo}` },
		ip
	});
}

function setError(connId: number, message: string | null) {
	getDb()
		.update(schema.githubConnections)
		.set(message ? { lastError: message, lastErrorAt: new Date() } : { lastError: null })
		.where(eq(schema.githubConnections.id, connId))
		.run();
}

async function githubApi(conn: GithubConnection, path: string) {
	let token: string | null = null;
	if (conn.tokenEnc) token = decryptSecret(conn.tokenEnc, GITHUB_TOKEN_PURPOSE);
	return safeFetch(`${API}${path}`, {
		maxBytes: 512 * 1024,
		timeoutMs: 8000,
		accept: 'application/vnd.github+json',
		headers: {
			'x-github-api-version': '2022-11-28',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		resolve: resolver
	});
}

/** Checks that the repository exists and is readable (with the token, if one is stored). */
export async function testConnection(conn: GithubConnection) {
	try {
		const res = await githubApi(conn, `/repos/${conn.owner}/${conn.repo}`);
		const repo = JSON.parse(res.body.toString('utf8')) as {
			id?: number;
			full_name?: string;
			private?: boolean;
		};
		if (repo.id && !conn.repoId)
			getDb()
				.update(schema.githubConnections)
				.set({ repoId: repo.id })
				.where(eq(schema.githubConnections.id, conn.id))
				.run();
		setError(conn.id, null);
		return {
			ok: true,
			message: `${repo.full_name ?? `${conn.owner}/${conn.repo}`} is reachable${repo.private ? ' (private repository)' : ''}.`
		};
	} catch (err) {
		const message =
			err instanceof SecretError
				? err.message
				: err instanceof FetchError && /status 404/.test(err.message)
					? conn.tokenEnc
						? 'GitHub answered 404: the repository does not exist or the token cannot read it.'
						: 'GitHub answered 404: the repository does not exist or is private (add a read-only token).'
					: err instanceof FetchError && /status 401|status 403/.test(err.message)
						? 'GitHub rejected the token (expired, revoked or missing permissions).'
						: `GitHub could not be reached: ${err instanceof Error ? err.message : 'unknown error'}`;
		setError(conn.id, message);
		return { ok: false, message };
	}
}

// ── Ticket references ──────────────────────────────────────────────────────

/** Ticket numbers referenced as KEY-123 (case-insensitive, whole words only). */
export function findTicketRefs(text: string, key: string, max = 20): number[] {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`(?<![A-Za-z0-9_-])${escaped}-(\\d{1,9})(?![A-Za-z0-9_])`, 'gi');
	const out = new Set<number>();
	for (const m of text.matchAll(re)) {
		out.add(Number(m[1]));
		if (out.size >= max) break;
	}
	return [...out];
}

function ticketsByNumbers(projectId: number, numbers: number[]) {
	if (!numbers.length) return [];
	return getDb()
		.select()
		.from(schema.tickets)
		.where(and(eq(schema.tickets.projectId, projectId), inArray(schema.tickets.number, numbers)))
		.all();
}

interface LinkInput {
	kind: DevLinkKind;
	ref: string;
	title: string;
	url: string;
	state: string | null;
	author: string | null;
	externalUpdatedAt: Date | null;
	source?: 'auto' | 'manual';
	createdById?: number | null;
}

function upsertLink(ticketId: number, connId: number, link: LinkInput) {
	const now = new Date();
	getDb()
		.insert(schema.ticketDevLinks)
		.values({
			ticketId,
			connectionId: connId,
			kind: link.kind,
			ref: link.ref,
			title: link.title.slice(0, 300),
			url: link.url,
			state: link.state,
			author: link.author?.slice(0, 100) ?? null,
			externalUpdatedAt: link.externalUpdatedAt,
			source: link.source ?? 'auto',
			createdById: link.createdById ?? null
		})
		.onConflictDoUpdate({
			target: [
				schema.ticketDevLinks.ticketId,
				schema.ticketDevLinks.connectionId,
				schema.ticketDevLinks.kind,
				schema.ticketDevLinks.ref
			],
			set: {
				title: link.title.slice(0, 300),
				url: link.url,
				state: link.state,
				author: link.author?.slice(0, 100) ?? null,
				externalUpdatedAt: link.externalUpdatedAt,
				updatedAt: now
			}
		})
		.run();
}

/** Development references of a ticket (cached metadata – nothing is fetched here). */
export function ticketDevLinks(ticketId: number) {
	return getDb()
		.select({
			id: schema.ticketDevLinks.id,
			kind: schema.ticketDevLinks.kind,
			ref: schema.ticketDevLinks.ref,
			title: schema.ticketDevLinks.title,
			url: schema.ticketDevLinks.url,
			state: schema.ticketDevLinks.state,
			author: schema.ticketDevLinks.author,
			source: schema.ticketDevLinks.source,
			updatedAt: schema.ticketDevLinks.externalUpdatedAt,
			createdAt: schema.ticketDevLinks.createdAt
		})
		.from(schema.ticketDevLinks)
		.where(eq(schema.ticketDevLinks.ticketId, ticketId))
		.orderBy(desc(schema.ticketDevLinks.createdAt))
		.all();
}

/**
 * Manually links a GitHub issue, pull request or commit to a ticket (project staff). Accepts
 * "#123", "issue 123", "pr 123", a commit SHA or a github.com URL of the connected repository.
 */
export async function addManualLink(
	actorId: number,
	access: ProjectAccess,
	ticket: Ticket,
	raw: string
) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can link development work', 'devLink', 403);
	const conn = getConnection(access.project.id);
	if (!conn) throw new ServiceError('Connect a GitHub repository first', 'devLink');
	const value = raw.trim();
	const repoUrl = `https://github.com/${conn.owner}/${conn.repo}`;
	let kind: DevLinkKind;
	let ref: string;
	const url =
		/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull|commit)\/([0-9a-f]{7,40}|\d+)\/?$/i.exec(
			value
		);
	if (url) {
		if (
			url[1].toLowerCase() !== conn.owner.toLowerCase() ||
			url[2].toLowerCase() !== conn.repo.toLowerCase()
		)
			throw new ServiceError(`Only links to ${conn.owner}/${conn.repo} can be added`, 'devLink');
		kind = url[3] === 'issues' ? 'issue' : url[3] === 'pull' ? 'pull_request' : 'commit';
		ref = url[4].toLowerCase();
	} else if (/^(?:pr|pull)\s*#?(\d{1,9})$/i.test(value)) {
		kind = 'pull_request';
		ref = /(\d+)/.exec(value)![1];
	} else if (/^(?:issue\s*)?#?(\d{1,9})$/i.test(value)) {
		kind = 'issue';
		ref = /(\d+)/.exec(value)![1];
	} else if (/^[0-9a-f]{7,40}$/i.test(value)) {
		kind = 'commit';
		ref = value.toLowerCase();
	} else
		throw new ServiceError(
			'Enter an issue or pull request number (#12, PR 12), a commit SHA or a GitHub link',
			'devLink'
		);
	if ((kind === 'issue' || kind === 'pull_request') && !/^\d+$/.test(ref))
		throw new ServiceError('Issue and pull request numbers are digits only', 'devLink');
	const path = kind === 'issue' ? 'issues' : kind === 'pull_request' ? 'pull' : 'commit';
	let title = '';
	let state: string | null = null;
	let author: string | null = null;
	// Best effort: read the title once now (cached; never on page views).
	try {
		const apiPath =
			kind === 'commit'
				? `/repos/${conn.owner}/${conn.repo}/commits/${ref}`
				: `/repos/${conn.owner}/${conn.repo}/${kind === 'issue' ? 'issues' : 'pulls'}/${ref}`;
		const res = await githubApi(conn, apiPath);
		const json = JSON.parse(res.body.toString('utf8'));
		if (kind === 'commit') {
			title = String(json.commit?.message ?? '').split('\n')[0];
			author = json.author?.login ?? json.commit?.author?.name ?? null;
			ref = String(json.sha ?? ref);
		} else {
			title = String(json.title ?? '');
			author = json.user?.login ?? null;
			state = json.merged_at ? 'merged' : json.state === 'closed' ? 'closed' : 'open';
		}
	} catch {
		/* keep the link without a title */
	}
	upsertLink(ticket.id, conn.id, {
		kind,
		ref,
		title: title || (kind === 'commit' ? ref.slice(0, 7) : `#${ref}`),
		url: `${repoUrl}/${path}/${ref}`,
		state,
		author,
		externalUpdatedAt: null,
		source: 'manual',
		createdById: actorId
	});
}

export function removeDevLink(access: ProjectAccess, ticket: Ticket, linkId: number) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can change development links', 'devLink', 403);
	getDb()
		.delete(schema.ticketDevLinks)
		.where(and(eq(schema.ticketDevLinks.id, linkId), eq(schema.ticketDevLinks.ticketId, ticket.id)))
		.run();
}

// ── Webhook ────────────────────────────────────────────────────────────────

export function findConnectionByPublicId(publicId: string) {
	if (!/^[A-Za-z0-9_-]{10,64}$/.test(publicId)) return undefined;
	return getDb()
		.select()
		.from(schema.githubConnections)
		.where(eq(schema.githubConnections.publicId, publicId))
		.get();
}

export function verifySignature(secret: string, body: Buffer, header: string | null) {
	if (!header?.startsWith('sha256=')) return false;
	const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
	return safeEqual(expected, header);
}

export interface WebhookResult {
	status: number;
	message: string;
}

interface Repo {
	id?: number;
	full_name?: string;
}

/**
 * Processes one GitHub webhook delivery. Order: signature → replay check → repository check →
 * event handling. Every rejection returns before any data is changed.
 */
export async function handleGithubWebhook(
	publicId: string,
	headers: { event: string | null; delivery: string | null; signature: string | null },
	body: Buffer
): Promise<WebhookResult> {
	const conn = findConnectionByPublicId(publicId);
	if (!conn) return { status: 404, message: 'Unknown webhook' };
	let secret: string;
	try {
		secret = decryptSecret(conn.webhookSecretEnc, GITHUB_SECRET_PURPOSE);
	} catch (err) {
		setError(conn.id, err instanceof Error ? err.message : 'The webhook secret cannot be read');
		return { status: 503, message: 'Integration misconfigured' };
	}
	if (!verifySignature(secret, body, headers.signature)) {
		setError(
			conn.id,
			'A delivery with an invalid signature was rejected. Check the webhook secret on GitHub.'
		);
		return { status: 401, message: 'Invalid signature' };
	}
	const delivery = headers.delivery ?? '';
	if (!/^[A-Za-z0-9-]{8,80}$/.test(delivery))
		return { status: 400, message: 'Missing delivery id' };
	const event = headers.event ?? '';
	let payload: { repository?: Repo; [k: string]: unknown };
	try {
		payload = JSON.parse(body.toString('utf8'));
	} catch {
		return { status: 400, message: 'Invalid JSON' };
	}
	const repo = payload.repository;
	const sameRepo =
		!!repo &&
		(repo.full_name ?? '').toLowerCase() === `${conn.owner}/${conn.repo}`.toLowerCase() &&
		(!conn.repoId || repo.id === conn.repoId);
	if (!sameRepo) return { status: 202, message: 'Ignored: event for another repository' };
	// Replay protection: each delivery id is processed once.
	const fresh = getDb()
		.insert(schema.githubDeliveries)
		.values({ id: delivery, connectionId: conn.id, event: event.slice(0, 40) })
		.onConflictDoNothing()
		.run().changes;
	if (!fresh) return { status: 200, message: 'Already processed' };

	getDb()
		.update(schema.githubConnections)
		.set({
			repoId: conn.repoId ?? repo?.id ?? null,
			lastEventAt: new Date(),
			lastEventType: event.slice(0, 40),
			lastError: null
		})
		.where(eq(schema.githubConnections.id, conn.id))
		.run();

	const project = findProjectById(conn.projectId);
	if (!project) return { status: 404, message: 'Unknown project' };
	if (event === 'ping') return { status: 200, message: 'pong' };
	if (event === 'push') return handlePush(conn, project, payload);
	if (event === 'pull_request') return handlePullRequest(conn, project, payload);
	return { status: 202, message: `Ignored event ${event.slice(0, 40)}` };
}

function handlePush(
	conn: GithubConnection,
	project: { id: number; key: string },
	payload: Record<string, unknown>
): WebhookResult {
	const commits = (Array.isArray(payload.commits) ? payload.commits : []).slice(0, 100) as {
		id?: string;
		message?: string;
		url?: string;
		timestamp?: string;
		author?: { username?: string; name?: string };
	}[];
	let linked = 0;
	for (const c of commits) {
		if (!c.id || !/^[0-9a-f]{40}$/i.test(c.id) || typeof c.message !== 'string') continue;
		const tickets = ticketsByNumbers(project.id, findTicketRefs(c.message, project.key));
		for (const t of tickets) {
			upsertLink(t.id, conn.id, {
				kind: 'commit',
				ref: c.id.toLowerCase(),
				title: c.message.split('\n')[0],
				url: `https://github.com/${conn.owner}/${conn.repo}/commit/${c.id.toLowerCase()}`,
				state: null,
				author: c.author?.username ?? c.author?.name ?? null,
				externalUpdatedAt: c.timestamp ? new Date(c.timestamp) : null
			});
			linked++;
		}
	}
	return { status: 200, message: `Linked ${linked} commit reference(s)` };
}

function handlePullRequest(
	conn: GithubConnection,
	project: { id: number; key: string; name: string },
	payload: Record<string, unknown>
): WebhookResult {
	const pr = payload.pull_request as
		| {
				number?: number;
				title?: string;
				body?: string | null;
				state?: string;
				merged?: boolean;
				user?: { login?: string };
				updated_at?: string;
		  }
		| undefined;
	const action = String(payload.action ?? '');
	if (!pr || !Number.isInteger(pr.number)) return { status: 400, message: 'Missing pull request' };
	const ref = String(pr.number);
	const state = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
	const link: LinkInput = {
		kind: 'pull_request',
		ref,
		title: String(pr.title ?? `#${ref}`),
		// Built from the connected repository, never taken from the payload.
		url: `https://github.com/${conn.owner}/${conn.repo}/pull/${ref}`,
		state,
		author: pr.user?.login ?? null,
		externalUpdatedAt: pr.updated_at ? new Date(pr.updated_at) : null
	};
	const referenced = ticketsByNumbers(
		project.id,
		findTicketRefs(`${pr.title ?? ''}\n${pr.body ?? ''}`, project.key)
	);
	for (const t of referenced) upsertLink(t.id, conn.id, link);
	// Tickets linked earlier (e.g. manually) get the new state too.
	const db = getDb();
	db.update(schema.ticketDevLinks)
		.set({
			state,
			title: link.title.slice(0, 300),
			externalUpdatedAt: link.externalUpdatedAt,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(schema.ticketDevLinks.connectionId, conn.id),
				eq(schema.ticketDevLinks.kind, 'pull_request'),
				eq(schema.ticketDevLinks.ref, ref)
			)
		)
		.run();
	let moved = 0;
	if (action === 'closed' && pr.merged && conn.mergeAction !== 'none') {
		const linkedIds = db
			.select({ ticketId: schema.ticketDevLinks.ticketId })
			.from(schema.ticketDevLinks)
			.where(
				and(
					eq(schema.ticketDevLinks.connectionId, conn.id),
					eq(schema.ticketDevLinks.kind, 'pull_request'),
					eq(schema.ticketDevLinks.ref, ref)
				)
			)
			.all()
			.map((r) => r.ticketId);
		const fullProject = findProjectById(project.id)!;
		for (const ticketId of linkedIds)
			if (
				setStatusBySystem(fullProject, ticketId, conn.mergeAction, {
					source: 'github',
					pr: pr.number,
					url: link.url
				})
			)
				moved++;
	}
	return {
		status: 200,
		message: `Updated pull request #${ref} on ${referenced.length} ticket(s)${moved ? `, moved ${moved}` : ''}`
	};
}
