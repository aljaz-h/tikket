import crypto from 'node:crypto';

/**
 * Application-level encryption for integration secrets stored in the database (SMTP password,
 * Discord webhook URLs, webhook signing secrets, GitHub webhook secrets and tokens).
 *
 * - AES-256-GCM with a random 96-bit IV per value; the GCM tag authenticates the ciphertext.
 * - Every value is bound to its purpose with additional authenticated data (e.g. "hook:url"), so
 *   a ciphertext copied into another column does not decrypt.
 * - The key comes from ENCRYPTION_KEY (32 random bytes, base64 or hex). Tikket never generates
 *   it silently: without a key, features that need to store secrets are unavailable.
 * - Rotation: put the old key in ENCRYPTION_KEY_PREVIOUS (comma-separated for several) and the
 *   new one in ENCRYPTION_KEY. Old values still decrypt and are re-encrypted at start-up.
 *
 * Format: `v1.<key id>.<iv>.<ciphertext>.<tag>` (base64url parts). The key id is a short hash
 * of the key so a wrong key produces a clear error instead of a generic decryption failure.
 */

export class SecretError extends Error {}

const PREFIX = 'v1';

/** Parses a 32-byte key given as 64 hex characters or base64/base64url. Returns null if invalid. */
export function parseKey(raw: string | undefined): Buffer | null {
	const value = raw?.trim();
	if (!value) return null;
	let key: Buffer | null = null;
	if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
	else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
		const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
		if (decoded.length === 32) key = decoded;
	}
	if (!key) return null;
	// Reject obviously non-random keys (all bytes equal, e.g. 000… or fff…).
	if (key.every((b) => b === key![0])) return null;
	return key;
}

export const KEY_HINT =
	'ENCRYPTION_KEY must be 32 random bytes encoded as base64 or hex. Generate one with: openssl rand -base64 32';

export function keyId(key: Buffer) {
	return crypto.createHash('sha256').update(key).digest('base64url').slice(0, 8);
}

interface Keys {
	current: Buffer | null;
	all: Map<string, Buffer>;
}

let cached: { source: string; keys: Keys } | null = null;

function keys(): Keys {
	const source = `${process.env.ENCRYPTION_KEY ?? ''}|${process.env.ENCRYPTION_KEY_PREVIOUS ?? ''}`;
	if (cached?.source === source) return cached.keys;
	const current = parseKey(process.env.ENCRYPTION_KEY);
	const all = new Map<string, Buffer>();
	if (current) all.set(keyId(current), current);
	for (const raw of (process.env.ENCRYPTION_KEY_PREVIOUS ?? '').split(',')) {
		const k = parseKey(raw);
		if (k && !all.has(keyId(k))) all.set(keyId(k), k);
	}
	cached = { source, keys: { current, all } };
	return cached.keys;
}

/** True when secrets can be stored (a valid ENCRYPTION_KEY is configured). */
export function encryptionAvailable() {
	return keys().current !== null;
}

export function encryptSecret(plain: string, purpose: string): string {
	const key = keys().current;
	if (!key)
		throw new SecretError(
			'Storing secrets requires ENCRYPTION_KEY to be set on the server. ' + KEY_HINT
		);
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(purpose));
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [PREFIX, keyId(key), iv, ct, tag]
		.map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
		.join('.');
}

function parts(box: string) {
	const p = box.split('.');
	if (p.length !== 5 || p[0] !== PREFIX) throw new SecretError('The stored secret is malformed.');
	return { kid: p[1], iv: p[2], ct: p[3], tag: p[4] };
}

export function decryptSecret(box: string, purpose: string): string {
	const { kid, iv, ct, tag } = parts(box);
	const { current, all } = keys();
	const key = all.get(kid);
	if (!key)
		throw new SecretError(
			current
				? 'A stored secret was encrypted with a different ENCRYPTION_KEY. Restore the original key (or add it to ENCRYPTION_KEY_PREVIOUS), or enter the secret again.'
				: 'ENCRYPTION_KEY is not set, so stored integration secrets cannot be read.'
		);
	try {
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
		decipher.setAAD(Buffer.from(purpose));
		decipher.setAuthTag(Buffer.from(tag, 'base64url'));
		return Buffer.concat([
			decipher.update(Buffer.from(ct, 'base64url')),
			decipher.final()
		]).toString('utf8');
	} catch {
		throw new SecretError('A stored secret could not be decrypted (it was modified or corrupted).');
	}
}

/** True if the value was encrypted with an older key and should be re-encrypted. */
export function needsRotation(box: string) {
	const current = keys().current;
	if (!current) return false;
	try {
		return parts(box).kid !== keyId(current);
	} catch {
		return false;
	}
}

/** Masks a secret for display, keeping a recognisable prefix. */
export function maskSecret(value: string, keep = 4) {
	return value.length <= keep ? '••••••••' : `${value.slice(0, keep)}••••••••`;
}
