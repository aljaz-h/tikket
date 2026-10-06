import type { TicketEnvironment } from './constants';

/** Normalises user input to a bare origin (scheme + host + port) or returns null. */
export function normalizeOrigin(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > 300) return null;
	// Any explicit scheme other than http(s) is rejected (instead of being read as a hostname).
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
	try {
		const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		if (url.username || url.password || !url.hostname) return null;
		return url.origin;
	} catch {
		return null;
	}
}

const MAX = { url: 1000, title: 200, browser: 40, version: 20, os: 40 };

function clip(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	// Strip control characters; everything here is untrusted input.
	// eslint-disable-next-line no-control-regex
	const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
	return clean ? clean.slice(0, max) : undefined;
}

/**
 * Removes query string, fragment and credentials from a page URL. Query parameters frequently
 * carry tokens, e-mail addresses or session identifiers, so they are never kept.
 */
export function stripUrl(value: unknown): string | undefined {
	const raw = clip(value, 4000);
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
		return `${url.origin}${url.pathname}`.slice(0, MAX.url);
	} catch {
		return undefined;
	}
}

/** Best-effort browser/OS detection from a user-agent string (untrusted, display only). */
export function describeUserAgent(ua: string | undefined): {
	browser?: string;
	browserVersion?: string;
	os?: string;
} {
	if (!ua) return {};
	const tests: [string, RegExp][] = [
		['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
		['Opera', /OPR\/([\d.]+)/],
		['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
		['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
		['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
		['Safari', /Version\/([\d.]+).*Safari/]
	];
	let browser: string | undefined;
	let browserVersion: string | undefined;
	for (const [name, re] of tests) {
		const m = re.exec(ua);
		if (m) {
			browser = name;
			browserVersion = m[1].split('.').slice(0, 2).join('.');
			break;
		}
	}
	const os = /Windows NT/.test(ua)
		? 'Windows'
		: /Android/.test(ua)
			? 'Android'
			: /iPhone|iPad|iPod/.test(ua)
				? 'iOS'
				: /Mac OS X|Macintosh/.test(ua)
					? 'macOS'
					: /CrOS/.test(ua)
						? 'ChromeOS'
						: /Linux/.test(ua)
							? 'Linux'
							: undefined;
	return { browser, browserVersion, os };
}

/**
 * Validates and reduces the context sent by the widget to a small, fixed set of display fields.
 * Unknown keys are dropped; values are clipped; URLs lose query and fragment.
 */
export function sanitizeEnvironment(raw: unknown, origin?: string): TicketEnvironment | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const ua = describeUserAgent(clip(r.userAgent, 400));
	const width = Number(r.viewportWidth);
	const height = Number(r.viewportHeight);
	const captured = typeof r.capturedAt === 'string' ? new Date(r.capturedAt) : null;
	const env: TicketEnvironment = {
		pageUrl: stripUrl(r.pageUrl),
		pageTitle: clip(r.pageTitle, MAX.title),
		browser: clip(r.browser, MAX.browser) ?? ua.browser,
		browserVersion: clip(r.browserVersion, MAX.version) ?? ua.browserVersion,
		os: clip(r.os, MAX.os) ?? ua.os,
		viewport:
			Number.isInteger(width) &&
			Number.isInteger(height) &&
			width > 0 &&
			height > 0 &&
			width < 20000 &&
			height < 20000
				? `${width}×${height}`
				: undefined,
		capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured.toISOString() : undefined,
		origin
	};
	// If the page URL is not on the embedding origin, keep only the origin we verified.
	if (env.pageUrl && origin && !env.pageUrl.startsWith(`${origin}/`) && env.pageUrl !== origin)
		env.pageUrl = undefined;
	const entries = Object.entries(env).filter(([, v]) => v !== undefined);
	return entries.length ? (Object.fromEntries(entries) as TicketEnvironment) : null;
}

export const ENVIRONMENT_LABELS: Record<keyof TicketEnvironment, string> = {
	pageUrl: 'Page',
	pageTitle: 'Page title',
	browser: 'Browser',
	browserVersion: 'Browser version',
	os: 'Operating system',
	viewport: 'Viewport',
	capturedAt: 'Reported at',
	origin: 'Website'
};
