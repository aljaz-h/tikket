import crypto from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
	PAT_SCOPES,
	PROJECT_TOKEN_SCOPES,
	type ApiScope,
	type TokenKind
} from '../../shared/constants';
import { computeProjectAccess, getMembershipRole, type ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { ApiToken, Project, User } from '../db/schema';
import { audit } from '../services/audit';
import { ServiceError } from '../services/users';

/**
 * API tokens.
 *
 * - Format: `tkt_pat_<40 chars>` (personal) or `tkt_prj_<40 chars>` (project): 240 bits from the
 *   OS CSPRNG. The full token is shown once at creation.
 * - Only a SHA-256 hash is stored (the token is random, so no salt/KDF is needed) plus a short
 *   prefix for recognising it in lists. Raw tokens are never logged or audited.
 * - Personal tokens act as their user – never with more rights than the user has – narrowed by
 *   scopes. Project tokens are bound to one project and act with the rights of the owner who
 *   created them; they stop working if that person is no longer an owner.
 * - Expired, revoked or disabled-user tokens stop working immediately.
 */

const TOKEN_RE = /^tkt_(pat|prj)_[A-Za-z0-9_-]{40}$/;
const PREFIX_LENGTH = 12; // "tkt_pat_ab12"
export const EXPIRY_DAYS = [7, 30, 90, 365] as const;
const LAST_USED_INTERVAL = 5 * 60 * 1000;

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function generate(kind: TokenKind) {
	const token = `tkt_${kind === 'personal' ? 'pat' : 'prj'}_${crypto.randomBytes(30).toString('base64url')}`;
	return { token, prefix: token.slice(0, PREFIX_LENGTH), hash: hashToken(token) };
}

export const tokenInput = z.object({
	name: z.string().trim().min(1, 'Give the token a name').max(60, 'At most 60 characters'),
	scopes: z.array(z.string()).min(1, 'Choose at least one scope'),
	/** Days until expiry; null = never. */
	expiresInDays: z
		.union([z.literal(null), z.number().int()])
		.refine((v) => v === null || (EXPIRY_DAYS as readonly number[]).includes(v), 'Choose an expiry')
});
export type TokenInput = z.infer<typeof tokenInput>;

function clean(kind: TokenKind, input: unknown) {
	const parsed = tokenInput.safeParse(input);
	if (!parsed.success) throw new ServiceError(parsed.error.issues[0].message, 'form');
	const allowed: readonly string[] = kind === 'personal' ? PAT_SCOPES : PROJECT_TOKEN_SCOPES;
	const scopes = [...new Set(parsed.data.scopes)].filter((s) => allowed.includes(s)) as ApiScope[];
	if (!scopes.length) throw new ServiceError('Choose at least one scope', 'scopes');
	return {
		name: parsed.data.name,
		scopes: allowed.filter((s) => scopes.includes(s as ApiScope)) as ApiScope[],
		expiresAt: parsed.data.expiresInDays
			? new Date(Date.now() + parsed.data.expiresInDays * 864e5)
			: null
	};
}

const MAX_TOKENS = 50;

function create(
	kind: TokenKind,
	userId: number,
	projectId: number | null,
	input: unknown,
	ip: string | null
) {
	const data = clean(kind, input);
	const count = getDb()
		.select({ id: schema.apiTokens.id })
		.from(schema.apiTokens)
		.where(
			and(
				kind === 'personal'
					? eq(schema.apiTokens.userId, userId)
					: eq(schema.apiTokens.projectId, projectId!),
				eq(schema.apiTokens.kind, kind),
				isNull(schema.apiTokens.revokedAt)
			)
		)
		.all().length;
	if (count >= MAX_TOKENS) throw new ServiceError(`At most ${MAX_TOKENS} active tokens`, 'form');
	const { token, prefix, hash } = generate(kind);
	const record = getDb()
		.insert(schema.apiTokens)
		.values({
			kind,
			userId,
			projectId,
			name: data.name,
			prefix,
			tokenHash: hash,
			scopes: data.scopes,
			expiresAt: data.expiresAt
		})
		.returning()
		.get();
	audit({
		actorId: userId,
		action: 'token.created',
		targetType: kind === 'personal' ? 'user' : 'project',
		targetId: kind === 'personal' ? userId : projectId!,
		// Never the token – only what identifies it.
		data: {
			tokenId: record.id,
			kind,
			name: data.name,
			prefix,
			scopes: data.scopes,
			expiresAt: data.expiresAt?.toISOString() ?? null
		},
		ip
	});
	return { token, record };
}

export function createPersonalToken(user: Pick<User, 'id'>, input: unknown, ip: string | null) {
	return create('personal', user.id, null, input, ip);
}

export function createProjectToken(
	userId: number,
	access: ProjectAccess,
	input: unknown,
	ip: string | null
) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can create project tokens', 'form', 403);
	return create('project', userId, access.project.id, input, ip);
}

/** Safe listing: name, masked prefix, dates and scopes – never the hash. */
export function listTokens(
	filter: { userId: number; kind: 'personal' } | { projectId: number; kind: 'project' }
) {
	const t = schema.apiTokens;
	return getDb()
		.select({
			id: t.id,
			name: t.name,
			prefix: t.prefix,
			scopes: t.scopes,
			createdAt: t.createdAt,
			lastUsedAt: t.lastUsedAt,
			expiresAt: t.expiresAt,
			revokedAt: t.revokedAt,
			createdBy: schema.users.displayName
		})
		.from(t)
		.innerJoin(schema.users, eq(schema.users.id, t.userId))
		.where(
			and(
				eq(t.kind, filter.kind),
				'userId' in filter ? eq(t.userId, filter.userId) : eq(t.projectId, filter.projectId)
			)
		)
		.orderBy(desc(t.id))
		.all();
}
export type TokenListItem = ReturnType<typeof listTokens>[number];

export const maskedPrefix = (prefix: string) => `${prefix}••••••••`;

/** Revokes a token the actor controls (own personal token, or a project token of their project). */
export function revokeToken(
	actorId: number,
	id: number,
	scope: { kind: 'personal' } | { kind: 'project'; access: ProjectAccess },
	ip: string | null
) {
	const token = getDb().select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)).get();
	const allowed =
		token &&
		(scope.kind === 'personal'
			? token.kind === 'personal' && token.userId === actorId
			: token.kind === 'project' &&
				token.projectId === scope.access.project.id &&
				scope.access.isOwner);
	if (!allowed) throw new ServiceError('Token not found', 'form');
	if (token.revokedAt) return;
	getDb()
		.update(schema.apiTokens)
		.set({ revokedAt: new Date() })
		.where(eq(schema.apiTokens.id, id))
		.run();
	audit({
		actorId,
		action: 'token.revoked',
		targetType: token.kind === 'personal' ? 'user' : 'project',
		targetId: token.kind === 'personal' ? token.userId : token.projectId!,
		data: { tokenId: id, kind: token.kind, name: token.name, prefix: token.prefix },
		ip
	});
}

// ── Authentication ─────────────────────────────────────────────────────────

export interface ApiAuth {
	kind: TokenKind;
	tokenId: number;
	tokenName: string;
	prefix: string;
	scopes: ApiScope[];
	user: Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'status'>;
	/** Set for project tokens: the only project the token can reach. */
	project: Project | null;
}

export type AuthFailure = 'missing' | 'malformed' | 'invalid' | 'expired' | 'revoked' | 'inactive';

const lastWrites = new Map<number, number>();

/** Updates last_used_at at most every few minutes per token (avoids a write per request). */
function touch(token: ApiToken, now: number) {
	const previous = lastWrites.get(token.id) ?? token.lastUsedAt?.getTime() ?? 0;
	if (now - previous < LAST_USED_INTERVAL) return;
	lastWrites.set(token.id, now);
	if (lastWrites.size > 10_000) lastWrites.clear();
	getDb()
		.update(schema.apiTokens)
		.set({ lastUsedAt: new Date(now) })
		.where(eq(schema.apiTokens.id, token.id))
		.run();
}

export function authenticateToken(header: string | null, now = Date.now()): ApiAuth | AuthFailure {
	if (!header) return 'missing';
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	if (!match || !TOKEN_RE.test(match[1])) return 'malformed';
	const token = getDb()
		.select()
		.from(schema.apiTokens)
		.where(eq(schema.apiTokens.tokenHash, hashToken(match[1])))
		.get();
	if (!token) return 'invalid';
	if (token.revokedAt) return 'revoked';
	if (token.expiresAt && token.expiresAt.getTime() <= now) return 'expired';
	const user = getDb()
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			role: schema.users.role,
			status: schema.users.status
		})
		.from(schema.users)
		.where(eq(schema.users.id, token.userId))
		.get();
	if (!user || user.status !== 'active') return 'inactive';
	let project: Project | null = null;
	if (token.kind === 'project') {
		project =
			getDb()
				.select()
				.from(schema.projects)
				.where(eq(schema.projects.id, token.projectId!))
				.get() ?? null;
		if (!project) return 'invalid';
		// A project token acts for its creator and only while they are an owner of the project.
		const access = computeProjectAccess(user, project, getMembershipRole(user.id, project.id));
		if (!access.isOwner) return 'inactive';
	}
	touch(token, now);
	return {
		kind: token.kind,
		tokenId: token.id,
		tokenName: token.name,
		prefix: token.prefix,
		scopes: token.scopes,
		user,
		project
	};
}
