import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { GlobalRole, ProjectRole } from '../../shared/constants';
import { hashPassword } from '../auth/password';
import { randomToken, sha256 } from '../auth/tokens';
import { getDb, schema, type DB } from '../db';
import type { User } from '../db/schema';
import { getSettings } from '../settings';
import { audit } from './audit';
import { ensureMember } from './projects';
import { ServiceError, type NewUser } from './users';

export interface InvitationInput {
	email: string | null;
	role: GlobalRole;
	projectId: number | null;
	projectRole: ProjectRole | null;
}

/** Creates an invitation and returns the raw token (only its hash is stored). */
export function createInvitation(actorId: number, input: InvitationInput, ip: string | null): string {
	const token = randomToken(32);
	const expiresAt = new Date(Date.now() + getSettings().invitationLifetimeDays * 24 * 60 * 60 * 1000);
	getDb().transaction((tx) => {
		const row = tx
			.insert(schema.invitations)
			.values({
				tokenHash: sha256(token),
				email: input.email,
				role: input.role,
				projectId: input.projectId,
				projectRole: input.projectId ? (input.projectRole ?? 'member') : null,
				createdById: actorId,
				expiresAt
			})
			.returning()
			.get();
		audit(
			{
				actorId,
				action: 'invitation.created',
				targetType: 'invitation',
				targetId: row.id,
				data: { email: input.email, role: input.role, projectId: input.projectId, projectRole: row.projectRole },
				ip
			},
			tx
		);
	});
	return token;
}

export function findValidInvitation(token: string) {
	if (!token || token.length > 128) return undefined;
	return getDb()
		.select({
			invitation: schema.invitations,
			projectName: schema.projects.name,
			projectKey: schema.projects.key,
			inviterName: schema.users.displayName
		})
		.from(schema.invitations)
		.leftJoin(schema.projects, eq(schema.projects.id, schema.invitations.projectId))
		.innerJoin(schema.users, eq(schema.users.id, schema.invitations.createdById))
		.where(
			and(
				eq(schema.invitations.tokenHash, sha256(token)),
				isNull(schema.invitations.usedAt),
				isNull(schema.invitations.revokedAt),
				gt(schema.invitations.expiresAt, new Date())
			)
		)
		.get();
}



/** Atomically claims an invitation; the role and project always come from the stored record. */
function claim(tx: DB, token: string, userId: number) {
	const inv = tx
		.select()
		.from(schema.invitations)
		.where(
			and(
				eq(schema.invitations.tokenHash, sha256(token)),
				isNull(schema.invitations.usedAt),
				isNull(schema.invitations.revokedAt),
				gt(schema.invitations.expiresAt, new Date())
			)
		)
		.get();
	if (!inv) throw new ServiceError('This invitation is invalid, already used or expired', 'form', 410);
	const res = tx
		.update(schema.invitations)
		.set({ usedAt: new Date(), usedById: userId })
		.where(and(eq(schema.invitations.id, inv.id), isNull(schema.invitations.usedAt)))
		.run();
	if (res.changes !== 1) throw new ServiceError('This invitation has already been used', 'form', 410);
	return inv;
}

export async function acceptInvitationAsNewUser(token: string, input: NewUser, ip: string | null): Promise<User> {
	const found = findValidInvitation(token);
	if (!found) throw new ServiceError('This invitation is invalid, already used or expired', 'form', 410);
	if (found.invitation.email && found.invitation.email.toLowerCase() !== input.email.toLowerCase())
		throw new ServiceError('Use the email address this invitation was sent to', 'email');
	const passwordHash = await hashPassword(input.password);
	return getDb().transaction(
		(tx) => {
			const clash = tx
				.select({ username: schema.users.username })
				.from(schema.users)
				.where(sql`lower(${schema.users.username}) = ${input.username.toLowerCase()} or lower(${schema.users.email}) = ${input.email.toLowerCase()}`)
				.get();
			if (clash)
				throw clash.username.toLowerCase() === input.username.toLowerCase()
					? new ServiceError('That username is already taken', 'username')
					: new ServiceError('An account with that email already exists – sign in instead', 'email');
			const user = tx
				.insert(schema.users)
				.values({
					username: input.username,
					email: input.email.toLowerCase(),
					displayName: input.displayName,
					passwordHash,
					role: found.invitation.role,
					passwordChangedAt: new Date()
				})
				.returning()
				.get();
			const inv = claim(tx, token, user.id);
			if (inv.projectId) ensureMember(inv.projectId, user.id, inv.projectRole ?? 'member', tx);
			audit({ actorId: user.id, action: 'invitation.accepted', targetType: 'invitation', targetId: inv.id, data: { newAccount: true }, ip }, tx);
			audit({ actorId: inv.createdById, action: 'user.created', targetType: 'user', targetId: user.id, data: { username: user.username, role: user.role, via: 'invitation' }, ip }, tx);
			return user;
		},
		{ behavior: 'immediate' }
	);
}

/** Existing accounts can accept project invitations; global roles are never changed this way. */
export function acceptInvitationAsExistingUser(token: string, user: { id: number; email: string }, ip: string | null) {
	return getDb().transaction(
		(tx) => {
			const inv = claim(tx, token, user.id);
			if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase())
				throw new ServiceError('This invitation was sent to a different email address', 'form', 403);
			if (!inv.projectId) throw new ServiceError('You already have an account', 'form', 409);
			ensureMember(inv.projectId, user.id, inv.projectRole ?? 'member', tx);
			audit({ actorId: user.id, action: 'invitation.accepted', targetType: 'invitation', targetId: inv.id, data: { projectId: inv.projectId }, ip }, tx);
			return inv.projectId;
		},
		{ behavior: 'immediate' }
	);
}

export function listInvitations(projectId?: number) {
	const creator = alias(schema.users, 'creator');
	const usedBy = alias(schema.users, 'used_by');
	return getDb()
		.select({
			id: schema.invitations.id,
			email: schema.invitations.email,
			role: schema.invitations.role,
			projectRole: schema.invitations.projectRole,
			projectKey: schema.projects.key,
			projectName: schema.projects.name,
			expiresAt: schema.invitations.expiresAt,
			usedAt: schema.invitations.usedAt,
			revokedAt: schema.invitations.revokedAt,
			createdAt: schema.invitations.createdAt,
			creatorName: creator.displayName,
			usedByName: usedBy.displayName
		})
		.from(schema.invitations)
		.leftJoin(schema.projects, eq(schema.projects.id, schema.invitations.projectId))
		.innerJoin(creator, eq(creator.id, schema.invitations.createdById))
		.leftJoin(usedBy, eq(usedBy.id, schema.invitations.usedById))
		.where(projectId ? eq(schema.invitations.projectId, projectId) : undefined)
		.orderBy(desc(schema.invitations.id))
		.limit(100)
		.all();
}

export function revokeInvitation(actorId: number, invitationId: number, projectId: number | null, ip: string | null) {
	return getDb().transaction((tx) => {
		const res = tx
			.update(schema.invitations)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(schema.invitations.id, invitationId),
					isNull(schema.invitations.usedAt),
					isNull(schema.invitations.revokedAt),
					projectId ? eq(schema.invitations.projectId, projectId) : undefined
				)
			)
			.run();
		if (res.changes) audit({ actorId, action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, ip }, tx);
		return res.changes;
	});
}
