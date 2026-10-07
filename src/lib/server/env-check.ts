import { parseSize } from './config';
import { KEY_HINT, parseKey } from './secrets';

/**
 * Start-up validation of deployment configuration. Errors abort the start (the container exits
 * with a clear message instead of running half-configured); warnings are logged.
 */
export interface EnvReport {
	errors: string[];
	warnings: string[];
}

const PLACEHOLDER_SECRETS = [/^change-?me/i, /^changeme/i, /^secret$/i, /^password$/i, /^x+$/i];
const HEADER_RE = /^[a-z0-9-]+$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
}

/** Mirrors adapter-node's BODY_SIZE_LIMIT parsing ("Infinity", bytes or K/M/G suffix). */
function parseBodyLimit(raw: string | undefined): number {
	if (!raw) return 512 * 1024;
	if (raw.trim() === 'Infinity') return Infinity;
	return parseSize(raw, NaN);
}

export function validateEnvironment(env: Record<string, string | undefined>): EnvReport {
	const errors: string[] = [];
	const warnings: string[] = [];
	const production = env.NODE_ENV === 'production';

	// ── Public origin ────────────────────────────────────────────────────
	const originRaw = env.ORIGIN?.trim();
	let origin: URL | null = null;
	if (!originRaw) {
		if (production)
			errors.push(
				'ORIGIN is not set. Set it to the public URL users open, e.g. ORIGIN=https://tikket.example.com. ' +
					'It is required for CSRF protection, secure cookies and correct links behind a reverse proxy.'
			);
	} else {
		origin = parseUrl(originRaw);
		if (!origin) errors.push(`ORIGIN "${originRaw}" is not a valid http(s) URL.`);
		else if (origin.pathname !== '/' || origin.search || origin.hash || originRaw.endsWith('/'))
			errors.push(
				`ORIGIN must be scheme + host (+ port) only, without a path or trailing slash – got "${originRaw}". ` +
					'Tikket must be served from the root of its domain.'
			);
		else if (origin.protocol === 'http:' && production && !LOCAL_HOSTS.has(origin.hostname))
			warnings.push(
				`ORIGIN uses plain HTTP (${originRaw}). Session cookies will not be marked Secure. ` +
					'Use https:// when TLS is terminated by a reverse proxy.'
			);
	}

	const appUrlRaw = env.APP_URL?.trim();
	if (appUrlRaw) {
		const appUrl = parseUrl(appUrlRaw);
		if (!appUrl) errors.push(`APP_URL "${appUrlRaw}" is not a valid http(s) URL.`);
		else if (origin && appUrl.origin !== origin.origin)
			warnings.push(
				`APP_URL (${appUrl.origin}) differs from ORIGIN (${origin.origin}). Invitation and reset links will point to APP_URL.`
			);
	}

	for (const name of ['PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER'])
		if (env[name] && originRaw)
			warnings.push(
				`${name} is ignored because ORIGIN is set (Tikket never derives its URL from request headers).`
			);

	// ── Secrets ──────────────────────────────────────────────────────────
	const secret = env.SESSION_SECRET;
	if (secret !== undefined && secret !== '') {
		if (secret.length < 32)
			errors.push(
				'SESSION_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48).'
			);
		else if (PLACEHOLDER_SECRETS.some((re) => re.test(secret)))
			errors.push(
				'SESSION_SECRET still contains the example placeholder. Generate a real secret: openssl rand -base64 48.'
			);
	} else if (production) {
		warnings.push(
			'SESSION_SECRET is not set; a random secret is generated once and stored in the data volume (DATA_DIR/.session-secret). ' +
				'Set SESSION_SECRET explicitly to manage it yourself.'
		);
	}

	// Integration secrets: never generated silently, so a typo must not go unnoticed.
	if (env.ENCRYPTION_KEY !== undefined && env.ENCRYPTION_KEY.trim() !== '') {
		if (!parseKey(env.ENCRYPTION_KEY)) errors.push(`ENCRYPTION_KEY is invalid. ${KEY_HINT}`);
	}
	for (const [i, raw] of (env.ENCRYPTION_KEY_PREVIOUS ?? '').split(',').entries())
		if (raw.trim() && !parseKey(raw))
			errors.push(`ENCRYPTION_KEY_PREVIOUS entry ${i + 1} is invalid. ${KEY_HINT}`);
	if (env.ENCRYPTION_KEY_PREVIOUS?.trim() && !env.ENCRYPTION_KEY?.trim())
		errors.push('ENCRYPTION_KEY_PREVIOUS is set but ENCRYPTION_KEY is not.');

	// ── SMTP (optional; environment settings take precedence over the admin UI) ──
	const smtpHost = env.SMTP_HOST?.trim();
	if (smtpHost) {
		if (!/^[a-z0-9.-]+$/i.test(smtpHost) && !/^\[[0-9a-f:]+\]$/i.test(smtpHost))
			errors.push(`SMTP_HOST "${smtpHost}" is not a valid host name.`);
		if (env.SMTP_PORT) {
			const port = Number(env.SMTP_PORT);
			if (!Number.isInteger(port) || port < 1 || port > 65535)
				errors.push(`SMTP_PORT "${env.SMTP_PORT}" is not a valid port.`);
		}
		if (env.SMTP_SECURITY && !['none', 'starttls', 'tls'].includes(env.SMTP_SECURITY))
			errors.push(`SMTP_SECURITY must be none, starttls or tls – got "${env.SMTP_SECURITY}".`);
		if (!env.SMTP_FROM?.trim() || !/^[^\s@]+@[^\s@]+$/.test(env.SMTP_FROM.trim()))
			errors.push('SMTP_FROM must be set to the sender address when SMTP_HOST is set.');
		if (env.SMTP_SECURITY === 'none' && env.SMTP_PASSWORD)
			warnings.push(
				'SMTP_SECURITY=none sends the SMTP password unencrypted. Use starttls or tls unless the server is on a trusted local network.'
			);
	} else if (['SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].some((n) => env[n]))
		warnings.push(
			'SMTP_* variables are set but SMTP_HOST is not; email stays as configured in the admin area.'
		);

	if (env.OUTBOUND_ALLOW_PRIVATE_NETWORKS === 'true')
		warnings.push(
			'OUTBOUND_ALLOW_PRIVATE_NETWORKS=true: webhooks may target private and loopback addresses. Only enable this on trusted, single-tenant installations.'
		);

	// ── Trusted proxy / client IP ────────────────────────────────────────
	const addressHeader = env.ADDRESS_HEADER?.trim();
	if (addressHeader) {
		if (!HEADER_RE.test(addressHeader))
			errors.push(`ADDRESS_HEADER "${addressHeader}" is not a valid header name.`);
		if (addressHeader.toLowerCase() === 'x-forwarded-for') {
			const depth = Number(env.XFF_DEPTH ?? '1');
			if (!Number.isInteger(depth) || depth < 1)
				errors.push(
					`XFF_DEPTH must be a positive integer (number of trusted proxies) – got "${env.XFF_DEPTH}".`
				);
		}
	}

	// ── Sizes and ports ──────────────────────────────────────────────────
	const maxUpload = parseSize(env.MAX_UPLOAD_SIZE, NaN);
	if (env.MAX_UPLOAD_SIZE && !Number.isFinite(maxUpload))
		errors.push(`MAX_UPLOAD_SIZE "${env.MAX_UPLOAD_SIZE}" is invalid (use e.g. 10M).`);
	const bodyLimit = parseBodyLimit(env.BODY_SIZE_LIMIT);
	if (Number.isNaN(bodyLimit))
		errors.push(`BODY_SIZE_LIMIT "${env.BODY_SIZE_LIMIT}" is invalid (use e.g. 25M).`);
	const effectiveUpload = Number.isFinite(maxUpload) ? maxUpload : 10 * 1024 * 1024;
	if (!Number.isNaN(bodyLimit) && bodyLimit < effectiveUpload)
		(env.BODY_SIZE_LIMIT ? errors : warnings).push(
			`BODY_SIZE_LIMIT (${env.BODY_SIZE_LIMIT ?? '512K default'}) is smaller than MAX_UPLOAD_SIZE (${env.MAX_UPLOAD_SIZE ?? '10M'}); ` +
				'image uploads would be rejected. Set BODY_SIZE_LIMIT to at least 2–3× MAX_UPLOAD_SIZE.'
		);

	if (env.PORT !== undefined && env.PORT !== '') {
		const port = Number(env.PORT);
		if (!Number.isInteger(port) || port < 1 || port > 65535)
			errors.push(`PORT "${env.PORT}" is not a valid port.`);
	}

	return { errors, warnings };
}
