import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SMTP_SECURITY, type SmtpSecurity } from '../../shared/constants';
import { getDb, schema } from '../db';
import { decryptSecret, encryptSecret, SecretError } from '../secrets';
import { audit } from '../services/audit';
import { ServiceError } from '../services/users';

/**
 * SMTP configuration. Two sources, never mixed:
 *
 * 1. Environment variables (SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USER, SMTP_PASSWORD,
 *    SMTP_FROM, SMTP_FROM_NAME, SMTP_REPLY_TO, SMTP_TIMEOUT). When SMTP_HOST is set they win and
 *    the admin form is read-only – good for immutable infrastructure and secret managers.
 * 2. Administration → Email, stored in app_settings. The password is encrypted with
 *    ENCRYPTION_KEY and never sent back to the browser.
 */

export const SMTP_PURPOSE = 'smtp:password';
const KEY = 'smtp';

export interface SmtpTestResult {
	at: number;
	ok: boolean;
	message: string;
}

export interface StoredSmtp {
	enabled: boolean;
	host: string;
	port: number;
	security: SmtpSecurity;
	username: string;
	passwordEnc: string | null;
	fromName: string;
	fromAddress: string;
	replyTo: string;
	timeoutSec: number;
	lastTest?: SmtpTestResult | null;
}

export interface EffectiveSmtp {
	source: 'env' | 'admin';
	enabled: boolean;
	host: string;
	port: number;
	security: SmtpSecurity;
	username: string;
	hasPassword: boolean;
	fromName: string;
	fromAddress: string;
	replyTo: string;
	timeoutSec: number;
	lastTest: SmtpTestResult | null;
	/** Decrypts (admin) or reads (env) the password only when a message is actually sent. */
	password: () => string | null;
}

const defaultPort = (security: SmtpSecurity) =>
	security === 'tls' ? 465 : security === 'starttls' ? 587 : 25;

export function smtpFromEnv(env: Record<string, string | undefined> = process.env) {
	const host = env.SMTP_HOST?.trim();
	if (!host) return null;
	const security = (SMTP_SECURITY as readonly string[]).includes(env.SMTP_SECURITY ?? '')
		? (env.SMTP_SECURITY as SmtpSecurity)
		: 'starttls';
	const password = env.SMTP_PASSWORD ?? '';
	return {
		source: 'env',
		enabled: env.SMTP_ENABLED !== 'false',
		host,
		port: Number(env.SMTP_PORT) || defaultPort(security),
		security,
		username: env.SMTP_USER ?? '',
		hasPassword: !!password,
		fromName: env.SMTP_FROM_NAME ?? '',
		fromAddress: env.SMTP_FROM?.trim() ?? '',
		replyTo: env.SMTP_REPLY_TO ?? '',
		timeoutSec: Math.min(Math.max(Number(env.SMTP_TIMEOUT) || 15, 3), 120),
		lastTest: null,
		password: () => password || null
	} satisfies EffectiveSmtp;
}

export function getStoredSmtp(): StoredSmtp | null {
	const row = getDb()
		.select()
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, KEY))
		.get();
	return (row?.value as StoredSmtp | undefined) ?? null;
}

function writeStored(value: StoredSmtp) {
	getDb()
		.insert(schema.appSettings)
		.values({ key: KEY, value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } })
		.run();
}

/** The configuration in effect, or null when email is not configured at all. */
export function effectiveSmtp(): EffectiveSmtp | null {
	const env = smtpFromEnv();
	const stored = getStoredSmtp();
	if (env) return { ...env, lastTest: stored?.lastTest ?? null };
	if (!stored?.host) return null;
	return {
		source: 'admin',
		enabled: stored.enabled,
		host: stored.host,
		port: stored.port,
		security: stored.security,
		username: stored.username,
		hasPassword: !!stored.passwordEnc,
		fromName: stored.fromName,
		fromAddress: stored.fromAddress,
		replyTo: stored.replyTo,
		timeoutSec: stored.timeoutSec,
		lastTest: stored.lastTest ?? null,
		password: () => (stored.passwordEnc ? decryptSecret(stored.passwordEnc, SMTP_PURPOSE) : null)
	};
}

/** True when notification emails can be sent. */
export function emailEnabled(): boolean {
	const cfg = effectiveSmtp();
	return !!cfg?.enabled && !!cfg.fromAddress;
}

/** Everything the admin page may show – no password, only whether one is stored. */
export function smtpForDisplay() {
	const cfg = effectiveSmtp();
	if (!cfg) return null;
	const { password: _password, ...visible } = cfg;
	return visible;
}

const hostRe =
	/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;
const optionalEmail = z.union([z.literal(''), z.email('Enter a valid email address')]);

export const smtpFormSchema = z.object({
	enabled: z.boolean(),
	host: z
		.string()
		.trim()
		.max(253)
		.refine((v) => hostRe.test(v), 'Enter a host name such as smtp.example.com'),
	port: z.coerce.number().int('Enter a port number').min(1).max(65535),
	security: z.enum(SMTP_SECURITY),
	username: z.string().trim().max(200),
	fromName: z.string().trim().max(80),
	fromAddress: z.email('Enter the sender address, e.g. tikket@example.com'),
	replyTo: optionalEmail,
	timeoutSec: z.coerce.number().int().min(3, 'At least 3 seconds').max(120, 'At most 120 seconds')
});
export type SmtpForm = z.infer<typeof smtpFormSchema>;

/**
 * Saves the admin SMTP configuration. An empty password keeps the stored one unless
 * `clearPassword` is set; a new password is encrypted (requires ENCRYPTION_KEY).
 */
export function saveSmtp(
	actorId: number,
	input: SmtpForm & { password?: string; clearPassword?: boolean },
	ip: string | null
) {
	if (smtpFromEnv())
		throw new ServiceError(
			'Email is configured with environment variables (SMTP_HOST …) and cannot be changed here.',
			'form',
			409
		);
	const previous = getStoredSmtp();
	let passwordEnc = previous?.passwordEnc ?? null;
	let passwordChange: 'kept' | 'set' | 'cleared' = 'kept';
	if (input.clearPassword) {
		passwordEnc = null;
		passwordChange = 'cleared';
	} else if (input.password) {
		try {
			passwordEnc = encryptSecret(input.password, SMTP_PURPOSE);
		} catch (err) {
			if (err instanceof SecretError) throw new ServiceError(err.message, 'password');
			throw err;
		}
		passwordChange = 'set';
	}
	const { password: _p, clearPassword: _c, ...fields } = input;
	writeStored({ ...fields, passwordEnc, lastTest: previous?.lastTest ?? null });
	audit({
		actorId,
		action: 'settings.smtp',
		targetType: 'settings',
		targetId: 'smtp',
		// Never the password – only whether it changed.
		data: {
			enabled: input.enabled,
			host: input.host,
			port: input.port,
			security: input.security,
			password: passwordChange
		},
		ip
	});
}

export function recordSmtpTest(result: SmtpTestResult) {
	const stored = getStoredSmtp();
	if (stored) writeStored({ ...stored, lastTest: result });
	else if (smtpFromEnv())
		writeStored({
			enabled: false,
			host: '',
			port: 587,
			security: 'starttls',
			username: '',
			passwordEnc: null,
			fromName: '',
			fromAddress: '',
			replyTo: '',
			timeoutSec: 15,
			lastTest: result
		});
}
