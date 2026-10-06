import { error, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import {
	SESSION_COOKIE,
	clearSessionCookie,
	deleteExpiredSessions,
	validateSessionToken
} from '$lib/server/auth/session';
import { getInstance } from '$lib/server/db';
import { getSettings } from '$lib/server/settings';
import { pruneOldNotifications } from '$lib/server/services/notifications';
import { needsSetup } from '$lib/server/services/users';
import { cleanupAbandonedUploads } from '$lib/server/uploads';
import { THEME_COOKIE, THEMES, type Theme } from '$lib/shared/constants';

function maintenance() {
	try {
		const uploads = cleanupAbandonedUploads();
		const sessions = deleteExpiredSessions();
		pruneOldNotifications();
		if (uploads || sessions) console.info(`[tikket] maintenance: removed ${uploads} abandoned uploads, ${sessions} expired sessions`);
	} catch (err) {
		console.error('[tikket] maintenance failed', err);
	}
}

export const init: ServerInit = async () => {
	// Opening the database applies pending migrations before the first request is served.
	getInstance();
	maintenance();
	setInterval(maintenance, 60 * 60 * 1000).unref();
};

let setupDone = false;
function setupRequired() {
	if (setupDone) return false;
	setupDone = !needsSetup();
	return !setupDone;
}

const SETUP_ALLOWED = ['/setup', '/api/health'];

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies, request } = event;
	const secure = url.protocol === 'https:';

	try {
		event.locals.clientIp = event.getClientAddress();
	} catch {
		event.locals.clientIp = null;
	}

	// Defence in depth on top of SvelteKit's form CSRF check: API mutations must be same-origin.
	if (url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
		const origin = request.headers.get('origin');
		if (!origin || origin !== url.origin) error(403, 'Cross-origin request blocked');
	}

	if (setupRequired()) {
		if (!SETUP_ALLOWED.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)))
			redirect(303, '/setup');
	}

	const token = cookies.get(SESSION_COOKIE);
	event.locals.user = null;
	event.locals.session = null;
	if (token) {
		const result = validateSessionToken(token);
		if (result) {
			event.locals.user = result.user;
			event.locals.session = result.session;
		} else clearSessionCookie(cookies, secure);
	}

	const cookieTheme = cookies.get(THEME_COOKIE) as Theme | undefined;
	const theme: Theme =
		event.locals.user?.theme ??
		(cookieTheme && THEMES.includes(cookieTheme) ? cookieTheme : getSettings().defaultTheme);
	event.locals.theme = theme;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%tikket.theme%', theme === 'system' ? 'theme-system' : theme === 'dark' ? 'dark' : 'light')
	});

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
	if (secure) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	if (event.locals.user && !response.headers.has('Cache-Control'))
		response.headers.set('Cache-Control', 'private, no-store');
	return response;
};

export const handleError: HandleServerError = ({ error: err, status, message }) => {
	if (status === 404) return { message: 'Not found' };
	const errorId = randomUUID();
	console.error(`[tikket] ${errorId}`, err);
	return { message: status >= 500 ? 'Something went wrong on our side.' : message, errorId };
};
