import {
	error,
	redirect,
	type Handle,
	type HandleServerError,
	type ServerInit
} from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import {
	SESSION_COOKIE,
	clearSessionCookie,
	deleteExpiredSessions,
	validateSessionToken
} from '$lib/server/auth/session';
import { closeDatabase, getInstance } from '$lib/server/db';
import { getSettings } from '$lib/server/settings';
import { checkConfiguration, checkDataDirectory, markReady } from '$lib/server/startup';
import { pruneOldNotifications } from '$lib/server/services/notifications';
import { needsSetup } from '$lib/server/services/users';
import { cleanupAbandonedUploads } from '$lib/server/uploads';
import { findWidget, listAllowedOrigins } from '$lib/server/services/widget';
import { pruneOutbound, startWorker, stopWorker, workerEnabled } from '$lib/server/outbound';
import { checkStoredSecrets } from '$lib/server/stored-secrets';
import { pruneIdempotency } from '$lib/server/api/resources';
import { pruneImports } from '$lib/server/services/import';
import { pruneAutomationRuns } from '$lib/server/automations/rules';
import { pruneReminders } from '$lib/server/services/reminders';
import { THEME_COOKIE, THEMES, type Theme } from '$lib/shared/constants';

function maintenance() {
	try {
		const uploads = cleanupAbandonedUploads();
		const sessions = deleteExpiredSessions();
		pruneOldNotifications();
		pruneOutbound();
		pruneIdempotency();
		pruneImports();
		pruneAutomationRuns();
		pruneReminders();
		if (uploads || sessions)
			console.info(
				`[tikket] maintenance: removed ${uploads} abandoned uploads, ${sessions} expired sessions`
			);
	} catch (err) {
		console.error('[tikket] maintenance failed', err);
	}
}

export const init: ServerInit = async () => {
	// Order matters: validate configuration, check storage, then migrate. Any failure aborts the
	// start-up with a clear message, and the health check never reports ready before this finishes.
	checkConfiguration();
	checkDataDirectory();
	getInstance(); // opens the database and applies pending migrations under a cross-process lock
	// Refuses to start with stored integration secrets but no ENCRYPTION_KEY; re-encrypts after
	// a key rotation.
	checkStoredSecrets();
	maintenance();
	setInterval(maintenance, 60 * 60 * 1000).unref();
	// Outbound deliveries (email, Discord, webhooks) run in this process from a SQLite queue.
	if (workerEnabled()) startWorker();
	// adapter-node emits this after draining connections on SIGTERM/SIGINT: let running
	// deliveries finish (bounded), then close the database. Unfinished jobs resume on next start.
	process.once('sveltekit:shutdown' as 'exit', async () => {
		await stopWorker();
		closeDatabase();
	});
	markReady();
	console.info(`[tikket] ready – serving ${process.env.ORIGIN || '(ORIGIN not set: development)'}`);
};

/** Origins allowed to frame the widget form of a project (empty list when disabled/unknown). */
function widgetFrameAncestors(key: string): string[] {
	const widget = findWidget(key);
	return widget ? listAllowedOrigins(widget.project.id) : [];
}

let setupDone = false;
function setupRequired() {
	if (setupDone) return false;
	setupDone = !needsSetup();
	return !setupDone;
}

const SETUP_ALLOWED = ['/setup', '/api/health', '/api/openapi.json'];

export const handle: Handle = async ({ event, resolve }) => {
	const { url, cookies, request } = event;
	const secure = url.protocol === 'https:';

	try {
		event.locals.clientIp = event.getClientAddress();
	} catch {
		event.locals.clientIp = null;
	}

	// Defence in depth on top of SvelteKit's form CSRF check: API mutations must be same-origin.
	// GitHub webhooks are server-to-server and authenticated by their HMAC signature instead; the
	// public REST API (/api/v1) authenticates with bearer tokens only and never reads cookies.
	const publicApi = url.pathname.startsWith('/api/v1/') || url.pathname === '/api/v1';
	if (
		url.pathname.startsWith('/api/') &&
		!publicApi &&
		!url.pathname.startsWith('/api/integrations/github/') &&
		!['GET', 'HEAD', 'OPTIONS'].includes(request.method)
	) {
		const origin = request.headers.get('origin');
		if (!origin || origin !== url.origin) error(403, 'Cross-origin request blocked');
	}

	if (publicApi) {
		// No session, no theme, no setup redirect: answer in the API's own JSON shape.
		event.locals.user = null;
		event.locals.session = null;
		event.locals.theme = 'system';
		const response = await resolve(event);
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Cache-Control', 'no-store');
		return response;
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
			html.replace(
				'%tikket.theme%',
				theme === 'system' ? 'theme-system' : theme === 'dark' ? 'dark' : 'light'
			)
	});

	// SvelteKit mirrors every <link rel=preload> of the page in a `Link` response header. The tags
	// are already in the HTML, and the header grows beyond the default 4–8 KB proxy buffers of
	// nginx / Nginx Proxy Manager ("upstream sent too big header" → 502), so drop it.
	response.headers.delete('link');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	// Embeddable feedback widget: only the widget form may be framed, and only by the project's
	// allowed origins (plus Tikket itself for the settings preview). Its sign-in popup must keep
	// `window.opener` to hand the token back, so it gets no COOP; it can never be framed.
	const embed =
		event.route.id === '/embed/[key]' && event.params.key
			? widgetFrameAncestors(event.params.key)
			: null;
	if (embed) {
		const csp = response.headers.get('content-security-policy');
		if (csp)
			response.headers.set(
				'content-security-policy',
				csp.replace(/frame-ancestors[^;]*/, `frame-ancestors 'self' ${embed.join(' ')}`.trim())
			);
	} else response.headers.set('X-Frame-Options', 'DENY');
	if (!event.route.id?.startsWith('/embed/'))
		response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (!response.headers.has('Cross-Origin-Resource-Policy'))
		response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), interest-cohort=()'
	);
	if (secure)
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	if (event.locals.user && !response.headers.has('Cache-Control'))
		response.headers.set('Cache-Control', 'private, no-store');
	return response;
};

export const handleError: HandleServerError = ({ error: err, event, status, message }) => {
	if (status === 404) return { message: 'Not found' };
	const errorId = randomUUID();
	// Structured context for the log (path without the query string, which may carry tokens).
	console.error(
		`[tikket] error id=${errorId} status=${status} method=${event.request.method} path=${event.url.pathname} route=${event.route.id ?? '-'} user=${event.locals.user?.id ?? '-'}`,
		err
	);
	return { message: status >= 500 ? 'Something went wrong on our side.' : message, errorId };
};
