import type { Cookies } from '@sveltejs/kit';
import { and, eq, lt, ne } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { User } from '../db/schema';
import { getSettings } from '../settings';
import { hmac, randomToken } from './tokens';

export const SESSION_COOKIE = 'tikket_session';
const DAY = 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL = 5 * 60 * 1000;

export type SessionUser = Pick<
	User,
	'id' | 'username' | 'email' | 'displayName' | 'role' | 'status' | 'avatarId' | 'theme'
>;

export interface SessionInfo {
	id: string;
	expiresAt: Date;
}

function lifetimeMs() {
	return getSettings().sessionLifetimeDays * DAY;
}

export function createSession(
	userId: number,
	meta: { ip?: string | null; userAgent?: string | null } = {}
): { token: string; expiresAt: Date; id: string } {
	const token = randomToken(32);
	const id = hmac(token);
	const expiresAt = new Date(Date.now() + lifetimeMs());
	getDb()
		.insert(schema.sessions)
		.values({
			id,
			userId,
			expiresAt,
			ipAddress: meta.ip ?? null,
			userAgent: meta.userAgent?.slice(0, 300) ?? null
		})
		.run();
	return { token, expiresAt, id };
}

/** Validates a cookie token, sliding the expiry window when more than half has elapsed. */
export function validateSessionToken(
	token: string
): { session: SessionInfo; user: SessionUser } | null {
	if (!token || token.length > 128) return null;
	const db = getDb();
	const id = hmac(token);
	const row = db
		.select({
			session: schema.sessions,
			user: {
				id: schema.users.id,
				username: schema.users.username,
				email: schema.users.email,
				displayName: schema.users.displayName,
				role: schema.users.role,
				status: schema.users.status,
				avatarId: schema.users.avatarId,
				theme: schema.users.theme
			}
		})
		.from(schema.sessions)
		.innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
		.where(eq(schema.sessions.id, id))
		.get();
	if (!row) return null;
	const now = Date.now();
	if (row.session.expiresAt.getTime() <= now || row.user.status !== 'active') {
		db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
		return null;
	}
	let expiresAt = row.session.expiresAt;
	const lifetime = lifetimeMs();
	const patch: Partial<typeof schema.sessions.$inferInsert> = {};
	if (expiresAt.getTime() - now < lifetime / 2) {
		expiresAt = new Date(now + lifetime);
		patch.expiresAt = expiresAt;
	}
	if (now - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL) patch.lastSeenAt = new Date(now);
	if (Object.keys(patch).length) {
		db.update(schema.sessions).set(patch).where(eq(schema.sessions.id, id)).run();
	}
	return { session: { id, expiresAt }, user: row.user };
}

export function invalidateSession(sessionId: string) {
	getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
}

/** Revokes every session of a user, optionally keeping the current one. */
export function invalidateUserSessions(userId: number, exceptSessionId?: string) {
	const db = getDb();
	const where = exceptSessionId
		? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptSessionId))
		: eq(schema.sessions.userId, userId);
	return db.delete(schema.sessions).where(where).run().changes;
}

export function deleteExpiredSessions() {
	return getDb().delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).run()
		.changes;
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date, secure: boolean) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies, secure: boolean) {
	cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}
