import nodemailer from 'nodemailer';
import { SecretError } from '../secrets';
import { DeliveryError } from '../outbound/queue';
import { effectiveSmtp, type EffectiveSmtp } from './config';

export interface Message {
	to: string;
	subject: string;
	html: string;
	text: string;
}

/** Test seam: replaces the SMTP transport (unit and integration tests). */
let transportOverride: ((cfg: EffectiveSmtp, message: Message) => Promise<void>) | null = null;
export function setTransportOverride(fn: typeof transportOverride) {
	transportOverride = fn;
}

function sanitizeHeader(value: string) {
	return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Sends one message with the effective configuration. Errors are classified for the queue:
 * connection problems, timeouts and 4xx SMTP replies are temporary; 5xx replies, rejected
 * credentials and configuration problems are permanent. Messages never include secrets.
 */
export async function sendMail(message: Message, cfg = effectiveSmtp()): Promise<void> {
	if (!cfg?.enabled) throw new DeliveryError('Email is not enabled.', false);
	if (!cfg.fromAddress) throw new DeliveryError('No sender address is configured.', false);
	const msg = {
		...message,
		to: sanitizeHeader(message.to),
		subject: sanitizeHeader(message.subject).slice(0, 200)
	};
	if (transportOverride) return transportOverride(cfg, msg);

	let password: string | null;
	try {
		password = cfg.password();
	} catch (err) {
		throw new DeliveryError(
			err instanceof SecretError ? err.message : 'The SMTP password could not be read.',
			false
		);
	}
	const transport = nodemailer.createTransport({
		host: cfg.host,
		port: cfg.port,
		secure: cfg.security === 'tls',
		requireTLS: cfg.security === 'starttls',
		ignoreTLS: cfg.security === 'none',
		auth: cfg.username ? { user: cfg.username, pass: password ?? '' } : undefined,
		connectionTimeout: cfg.timeoutSec * 1000,
		greetingTimeout: cfg.timeoutSec * 1000,
		socketTimeout: cfg.timeoutSec * 2000,
		// Certificates are always verified; there is deliberately no switch to turn that off.
		tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: cfg.host },
		logger: false,
		debug: false
	});
	try {
		await transport.sendMail({
			from: cfg.fromName
				? { name: sanitizeHeader(cfg.fromName), address: cfg.fromAddress }
				: cfg.fromAddress,
			replyTo: cfg.replyTo || undefined,
			to: msg.to,
			subject: msg.subject,
			text: msg.text,
			html: msg.html,
			headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }
		});
	} catch (err) {
		throw classify(err);
	} finally {
		transport.close();
	}
}

export function classify(err: unknown): DeliveryError {
	const e = err as { code?: string; responseCode?: number; message?: string };
	const code = e?.code ?? '';
	const reply = e?.responseCode;
	if (code === 'EAUTH')
		return new DeliveryError('The SMTP server rejected the credentials.', false);
	if (code === 'ETLS' || /certificate|self.signed|CERT_/i.test(e?.message ?? ''))
		return new DeliveryError(
			'TLS failed: the SMTP server certificate could not be verified or TLS is not supported.',
			false
		);
	if (typeof reply === 'number') {
		const text = `The SMTP server answered ${reply}`;
		return new DeliveryError(text, reply < 500);
	}
	if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET'].includes(code))
		return new DeliveryError(
			code === 'ETIMEDOUT'
				? 'The SMTP server did not answer in time.'
				: `Could not connect to the SMTP server (${code}).`,
			true
		);
	if (code === 'EENVELOPE') return new DeliveryError('The recipient address was rejected.', false);
	return new DeliveryError('Sending failed.', true);
}
