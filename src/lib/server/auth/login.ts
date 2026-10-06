import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { authenticate } from '../services/users';
import { formatWait, limiters } from './rate-limit';
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

/**
 * Credential sign-in shared by the login page and the widget's sign-in popup: rate limits per
 * account and per IP, constant-ish timing for unknown accounts, then a new session cookie.
 * Returns an error message, or null on success.
 */
export async function attemptLogin(
	event: RequestEvent,
	identifier: string,
	password: string
): Promise<{ status: number; message: string } | null> {
	const accountKey = identifier.toLowerCase();
	const ipKey = event.locals.clientIp ?? 'unknown';
	const wait = Math.max(limiters.loginAccount.check(accountKey), limiters.loginIp.check(ipKey));
	if (wait)
		return { status: 429, message: `Too many sign-in attempts. Try again in ${formatWait(wait)}.` };
	limiters.loginIp.hit(ipKey);
	const user = await authenticate(identifier, password);
	if (!user) {
		limiters.loginAccount.hit(accountKey);
		return { status: 400, message: 'Incorrect username/email or password.' };
	}
	limiters.loginAccount.reset(accountKey);
	signIn(event.cookies, user.id, {
		ip: event.locals.clientIp,
		userAgent: event.request.headers.get('user-agent'),
		secure: event.url.protocol === 'https:'
	});
	return null;
}
