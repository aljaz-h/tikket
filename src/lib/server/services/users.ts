import { and, asc, eq, gt, isNull, like, ne, or, sql } from 'drizzle-orm';
import {
	DEFAULT_NOTIFICATION_PREFS,
	type GlobalRole,
	type NotificationPrefs,
	type Theme
} from '../../shared/constants';
import { hashPassword, verifyDummy, verifyPassword } from '../auth/password';
import { invalidateUserSessions } from '../auth/session';
import { randomToken, sha256 } from '../auth/tokens';
import { getDb, schema, type DB } from '../db';
import type { User } from '../db/schema';
import { audit } from './audit';

export class ServiceError extends Error {
	constructor(
		message: string,
		public field = 'form',
		public status = 400
	) {
		super(message);
	}
}

export interface NewUser {
	username: string;
	email: string;
	displayName: string;
	password: string;
	role?: GlobalRole;
}

export function countAdmins(db: Pick<DB, 'select'> = getDb()): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.users)
			.where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active')))
			.get()?.n ?? 0
	);
}

/** Setup is required until at least one administrator exists. */
export function needsSetup(): boolean {
	return (
		(getDb()
			.select({ n: sql<number>`count(*)` })
			.from(schema.users)
			.where(eq(schema.users.role, 'admin'))
			.get()?.n ?? 0) === 0
	);
}

function assertUnique(tx: Pick<DB, 'select'>, username: string, email: string, exceptId?: number) {
	const clash = tx
		.select({ id: schema.users.id, username: schema.users.username, email: schema.users.email })
		.from(schema.users)
		.where(
			and(
				or(
					sql`lower(${schema.users.username}) = ${username.toLowerCase()}`,
					sql`lower(${schema.users.email}) = ${email.toLowerCase()}`
				),
				exceptId ? ne(schema.users.id, exceptId) : undefined
			)
		)
		.get();
	if (!clash) return;
	if (clash.username.toLowerCase() === username.toLowerCase())
		throw new ServiceError('That username is already taken', 'username');
	throw new ServiceError('An account with that email already exists', 'email');
}

function insertUser(tx: DB, input: NewUser, passwordHash: string): User {
	assertUnique(tx, input.username, input.email);
	return tx
		.insert(schema.users)
		.values({
			username: input.username,
			email: input.email.toLowerCase(),
			displayName: input.displayName,
			passwordHash,
			role: input.role ?? 'user',
			passwordChangedAt: new Date()
		})
		.returning()
		.get();
}

/**
 * Creates the first administrator. The admin-count check and insert run inside a single
 * IMMEDIATE transaction, so concurrent setup requests cannot both succeed.
 */
export async function setupFirstAdmin(input: NewUser, ip: string | null): Promise<User> {
	const passwordHash = await hashPassword(input.password);
	const db = getDb();
	return db.transaction(
		(tx) => {
			const admins = tx
				.select({ n: sql<number>`count(*)` })
				.from(schema.users)
				.where(eq(schema.users.role, 'admin'))
				.get();
			if ((admins?.n ?? 0) > 0) throw new ServiceError('Tikket has already been set up', 'form', 409);
			const user = insertUser(tx, { ...input, role: 'admin' }, passwordHash);
			audit({ actorId: user.id, action: 'setup.completed', targetType: 'user', targetId: user.id, ip }, tx);
			return user;
		},
		{ behavior: 'immediate' }
	);
}

export async function createUser(
	input: NewUser,
	actor: { id: number } | null,
	ip: string | null,
	action: 'user.created' | 'user.registered' = 'user.created'
): Promise<User> {
	const passwordHash = await hashPassword(input.password);
	return getDb().transaction(
		(tx) => {
			const user = insertUser(tx, input, passwordHash);
			audit(
				{
					actorId: actor?.id ?? user.id,
					action,
					targetType: 'user',
					targetId: user.id,
					data: { username: user.username, role: user.role },
					ip
				},
				tx
			);
			return user;
		},
		{ behavior: 'immediate' }
	);
}

export function findUserByIdentifier(identifier: string): User | undefined {
	const value = identifier.trim().toLowerCase();
	return getDb()
		.select()
		.from(schema.users)
		.where(or(sql`lower(${schema.users.username}) = ${value}`, sql`lower(${schema.users.email}) = ${value}`))
		.get();
}

export function getUser(id: number): User | undefined {
	return getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
}

export function getUserByUsername(name: string): User | undefined {
	return getDb()
		.select()
		.from(schema.users)
		.where(sql`lower(${schema.users.username}) = ${name.toLowerCase()}`)
		.get();
}

/** Verifies credentials in roughly constant time whether or not the account exists. */
export async function authenticate(identifier: string, password: string): Promise<User | null> {
	const user = findUserByIdentifier(identifier);
	if (!user) return verifyDummy(password).then(() => null);
	const ok = await verifyPassword(user.passwordHash, password);
	if (!ok || user.status !== 'active') return null;
	getDb()
		.update(schema.users)
		.set({ lastLoginAt: new Date() })
		.where(eq(schema.users.id, user.id))
		.run();
	return user;
}

export function updateProfile(
	userId: number,
	input: { displayName: string; username: string; email: string; bio: string | null }
) {
	const db = getDb();
	db.transaction((tx) => {
		assertUnique(tx, input.username, input.email, userId);
		tx.update(schema.users)
			.set({ ...input, email: input.email.toLowerCase(), updatedAt: new Date() })
			.where(eq(schema.users.id, userId))
			.run();
	});
}

export function setTheme(userId: number, theme: Theme) {
	getDb().update(schema.users).set({ theme }).where(eq(schema.users.id, userId)).run();
}

export function setAvatar(userId: number, avatarId: string | null) {
	getDb()
		.update(schema.users)
		.set({ avatarId, updatedAt: new Date() })
		.where(eq(schema.users.id, userId))
		.run();
}

export function getNotificationPrefs(user: Pick<User, 'notificationPrefs'>): NotificationPrefs {
	return { ...DEFAULT_NOTIFICATION_PREFS, ...(user.notificationPrefs ?? {}) };
}

export function setNotificationPrefs(userId: number, prefs: NotificationPrefs) {
	getDb()
		.update(schema.users)
		.set({ notificationPrefs: prefs })
		.where(eq(schema.users.id, userId))
		.run();
}

/** Changes a password after verifying the current one; revokes all other sessions. */
export async function changePassword(
	userId: number,
	currentPassword: string,
	newPassword: string,
	currentSessionId: string,
	ip: string | null
) {
	const user = getUser(userId);
	if (!user || !(await verifyPassword(user.passwordHash, currentPassword)))
		throw new ServiceError('Your current password is incorrect', 'currentPassword');
	const passwordHash = await hashPassword(newPassword);
	getDb().transaction((tx) => {
		tx.update(schema.users)
			.set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.users.id, userId))
			.run();
		audit({ actorId: userId, action: 'user.password_changed', targetType: 'user', targetId: userId, ip }, tx);
	});
	invalidateUserSessions(userId, currentSessionId);
}

export function setUserRole(actorId: number, userId: number, role: GlobalRole, ip: string | null) {
	getDb().transaction(
		(tx) => {
			const user = tx.select().from(schema.users).where(eq(schema.users.id, userId)).get();
			if (!user) throw new ServiceError('User not found', 'form', 404);
			if (user.role === role) return;
			if (user.role === 'admin' && countAdmins(tx) <= 1)
				throw new ServiceError('Tikket needs at least one active administrator');
			tx.update(schema.users).set({ role, updatedAt: new Date() }).where(eq(schema.users.id, userId)).run();
			audit(
				{ actorId, action: 'user.role_changed', targetType: 'user', targetId: userId, data: { from: user.role, to: role }, ip },
				tx
			);
		},
		{ behavior: 'immediate' }
	);
}

export function setUserStatus(
	actorId: number,
	userId: number,
	status: 'active' | 'disabled',
	ip: string | null
) {
	if (actorId === userId && status === 'disabled')
		throw new ServiceError('You cannot disable your own account');
	getDb().transaction(
		(tx) => {
			const user = tx.select().from(schema.users).where(eq(schema.users.id, userId)).get();
			if (!user) throw new ServiceError('User not found', 'form', 404);
			if (user.status === status) return;
			if (status === 'disabled' && user.role === 'admin' && countAdmins(tx) <= 1)
				throw new ServiceError('Tikket needs at least one active administrator');
			tx.update(schema.users).set({ status, updatedAt: new Date() }).where(eq(schema.users.id, userId)).run();
			audit(
				{ actorId, action: status === 'disabled' ? 'user.disabled' : 'user.enabled', targetType: 'user', targetId: userId, ip },
				tx
			);
		},
		{ behavior: 'immediate' }
	);
	if (status === 'disabled') invalidateUserSessions(userId);
}

export function revokeUserSessions(actorId: number, userId: number, ip: string | null) {
	const count = invalidateUserSessions(userId);
	audit({ actorId, action: 'user.sessions_revoked', targetType: 'user', targetId: userId, data: { count }, ip });
	return count;
}

const RESET_LIFETIME = 24 * 60 * 60 * 1000;

/** Issues a single-use password reset link (shared by an administrator out of band). */
export function createPasswordReset(actorId: number, userId: number, ip: string | null): string {
	const token = randomToken(32);
	getDb().transaction((tx) => {
		const user = tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get();
		if (!user) throw new ServiceError('User not found', 'form', 404);
		// Only the newest link is valid.
		tx.update(schema.passwordResets)
			.set({ usedAt: new Date() })
			.where(and(eq(schema.passwordResets.userId, userId), isNull(schema.passwordResets.usedAt)))
			.run();
		tx.insert(schema.passwordResets)
			.values({ tokenHash: sha256(token), userId, createdById: actorId, expiresAt: new Date(Date.now() + RESET_LIFETIME) })
			.run();
		audit({ actorId, action: 'user.password_reset_issued', targetType: 'user', targetId: userId, ip }, tx);
	});
	return token;
}

export function findValidPasswordReset(token: string) {
	if (!token || token.length > 128) return undefined;
	return getDb()
		.select({ reset: schema.passwordResets, user: { id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName } })
		.from(schema.passwordResets)
		.innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
		.where(
			and(
				eq(schema.passwordResets.tokenHash, sha256(token)),
				isNull(schema.passwordResets.usedAt),
				gt(schema.passwordResets.expiresAt, new Date())
			)
		)
		.get();
}

export async function consumePasswordReset(token: string, newPassword: string, ip: string | null) {
	const passwordHash = await hashPassword(newPassword);
	const userId = getDb().transaction(
		(tx) => {
			const found = tx
				.select()
				.from(schema.passwordResets)
				.where(
					and(
						eq(schema.passwordResets.tokenHash, sha256(token)),
						isNull(schema.passwordResets.usedAt),
						gt(schema.passwordResets.expiresAt, new Date())
					)
				)
				.get();
			if (!found) throw new ServiceError('This reset link is invalid or has expired');
			tx.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, found.id)).run();
			tx.update(schema.users)
				.set({ passwordHash, passwordChangedAt: new Date(), updatedAt: new Date() })
				.where(eq(schema.users.id, found.userId))
				.run();
			audit({ actorId: found.userId, action: 'user.password_reset_used', targetType: 'user', targetId: found.userId, ip }, tx);
			return found.userId;
		},
		{ behavior: 'immediate' }
	);
	invalidateUserSessions(userId);
	return userId;
}

export function listUsers(opts: { q?: string; page: number; pageSize: number }) {
	const db = getDb();
	const q = opts.q?.trim();
	const where = q
		? or(
				like(schema.users.username, `%${q}%`),
				like(schema.users.email, `%${q}%`),
				like(schema.users.displayName, `%${q}%`)
			)
		: undefined;
	const rows = db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			email: schema.users.email,
			displayName: schema.users.displayName,
			role: schema.users.role,
			status: schema.users.status,
			avatarId: schema.users.avatarId,
			createdAt: schema.users.createdAt,
			lastLoginAt: schema.users.lastLoginAt
		})
		.from(schema.users)
		.where(where)
		.orderBy(asc(sql`lower(${schema.users.displayName})`))
		.limit(opts.pageSize)
		.offset((opts.page - 1) * opts.pageSize)
		.all();
	const total = db.select({ n: sql<number>`count(*)` }).from(schema.users).where(where).get()?.n ?? 0;
	return { rows, total };
}

/** Lightweight lookup for pickers (members, assignees, mentions). */
export function searchUsers(q: string, limit = 10) {
	const term = `%${q.trim()}%`;
	return getDb()
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			avatarId: schema.users.avatarId
		})
		.from(schema.users)
		.where(
			and(
				eq(schema.users.status, 'active'),
				or(like(schema.users.username, term), like(schema.users.displayName, term), like(schema.users.email, term))
			)
		)
		.orderBy(asc(schema.users.username))
		.limit(limit)
		.all();
}

export function listUserSessions(userId: number) {
	return getDb()
		.select({
			id: schema.sessions.id,
			createdAt: schema.sessions.createdAt,
			lastSeenAt: schema.sessions.lastSeenAt,
			expiresAt: schema.sessions.expiresAt,
			ipAddress: schema.sessions.ipAddress,
			userAgent: schema.sessions.userAgent
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.userId, userId))
		.orderBy(sql`${schema.sessions.lastSeenAt} desc`)
		.all();
}

export function deleteUserSession(userId: number, sessionId: string) {
	return getDb()
		.delete(schema.sessions)
		.where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.id, sessionId)))
		.run().changes;
}

export const publicUserColumns = {
	id: schema.users.id,
	username: schema.users.username,
	displayName: schema.users.displayName,
	avatarId: schema.users.avatarId
};
