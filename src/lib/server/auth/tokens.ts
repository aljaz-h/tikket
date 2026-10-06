import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

/** Short random identifier for files (lowercase, URL and filesystem safe). */
export function randomId(bytes = 16): string {
	return randomBytes(bytes).toString('hex');
}

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

let secret: string | null = null;

/**
 * Server secret used to derive session identifiers. Taken from SESSION_SECRET or generated
 * once and persisted inside the data directory (never committed to the repository).
 */
export function serverSecret(): string {
	if (secret) return secret;
	if (config.sessionSecret && config.sessionSecret.length >= 32) {
		secret = config.sessionSecret;
		return secret;
	}
	const file = path.join(config.dataDir, '.session-secret');
	try {
		secret = fs.readFileSync(file, 'utf8').trim();
	} catch {
		fs.mkdirSync(config.dataDir, { recursive: true });
		secret = randomToken(48);
		fs.writeFileSync(file, secret, { mode: 0o600 });
	}
	return secret;
}

export function hmac(value: string): string {
	return createHmac('sha256', serverSecret()).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}
