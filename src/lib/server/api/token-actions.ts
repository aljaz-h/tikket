import { fail } from '@sveltejs/kit';
import { formatWait, RateLimiter } from '../auth/rate-limit';
import { maskedPrefix, type TokenListItem } from './tokens';

/** Token creation is rare; this stops a compromised session from minting tokens in a loop. */
export const tokenCreateLimiter = new RateLimiter(10, 60 * 60 * 1000);

/** Parses the create-token form: name, scope checkboxes and an expiry choice. */
export function readTokenForm(form: FormData) {
	const expiry = String(form.get('expiry') ?? '');
	return {
		name: String(form.get('name') ?? ''),
		scopes: form.getAll('scopes').map(String),
		expiresInDays: expiry === 'never' ? null : Number(expiry)
	};
}

export function rateLimited(key: string) {
	const wait = tokenCreateLimiter.hit(key);
	return wait
		? fail(429, {
				errors: { form: `Too many new tokens. Try again in ${formatWait(wait)}.` },
				values: {}
			})
		: null;
}

/** What the browser gets for a token list: never the hash, only the masked prefix. */
export const presentTokens = (tokens: TokenListItem[], now = Date.now()) =>
	tokens.map((t) => ({
		id: t.id,
		name: t.name,
		prefix: maskedPrefix(t.prefix),
		scopes: t.scopes,
		createdAt: t.createdAt,
		lastUsedAt: t.lastUsedAt,
		expiresAt: t.expiresAt,
		createdBy: t.createdBy,
		state: t.revokedAt
			? ('revoked' as const)
			: t.expiresAt && t.expiresAt.getTime() <= now
				? ('expired' as const)
				: ('active' as const)
	}));
