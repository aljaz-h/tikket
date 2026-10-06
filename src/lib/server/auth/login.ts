import type { Cookies } from '@sveltejs/kit';
import { createSession, setSessionCookie } from './session';

/** Starts a session for the user and sets the cookie. */
export function signIn(
	cookies: Cookies,
	userId: number,
	meta: { ip: string | null; userAgent: string | null; secure: boolean }
) {
	const session = createSession(userId, meta);
	setSessionCookie(cookies, session.token, session.expiresAt, meta.secure);
	return session;
}
