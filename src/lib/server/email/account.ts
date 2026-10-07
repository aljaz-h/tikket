import { eq, sql, type SQLWrapper } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { DeliveryError, enqueue } from '../outbound/queue';
import { createPasswordReset } from '../services/users';
import { getSettings } from '../settings';
import { emailEnabled, effectiveSmtp, recordSmtpTest } from './config';
import { sendMail } from './mailer';
import { publicBaseUrl } from './notifications';
import { renderEmail } from './template';

/**
 * Account emails: invitations, password reset links and the administrator's test email.
 *
 * Reset tokens are never stored in the queue: a self-service reset job only carries the user id
 * and the token is created when the email is actually sent.
 */

export function passwordResetEmail(userId: number) {
	const user = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
	if (!user || user.status !== 'active' || !user.email) return null;
	const base = publicBaseUrl();
	if (!base) return null;
	const token = createPasswordReset(user.id, user.id, null);
	const appName = getSettings().appName;
	const url = `${base}/reset/${token}`;
	const { html, text } = renderEmail({
		appName,
		preheader: 'Reset your password',
		heading: 'Reset your password',
		paragraphs: [
			`Hi ${user.displayName}, someone (hopefully you) asked to reset the password of your ${appName} account “${user.username}”.`,
			'The link works once and expires in 24 hours. If you did not ask for this, ignore this email – your password stays unchanged.'
		],
		action: { label: 'Choose a new password', url },
		footer: `${appName} sends this email only when a password reset is requested.`
	});
	return { to: user.email, subject: `Reset your ${appName} password`, html, text };
}

/**
 * Self-service "forgot password": queues a reset email if the identifier belongs to an active
 * account. Always behaves the same for unknown accounts (no account enumeration) and sends at
 * most one email per account every 10 minutes.
 */
export function requestPasswordResetEmail(identifier: string) {
	if (!emailEnabled()) return;
	const id = identifier.trim().toLowerCase();
	if (!id || id.length > 254) return;
	const user = getDb()
		.select({ id: schema.users.id, status: schema.users.status, email: schema.users.email })
		.from(schema.users)
		.where(
			id.includes('@')
				? eq(sqlLower(schema.users.email), id)
				: eq(sqlLower(schema.users.username), id)
		)
		.get();
	if (!user || user.status !== 'active' || !user.email) return;
	const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
	enqueue({
		kind: 'email',
		payload: { template: 'password_reset', userId: user.id, summary: 'Password reset' },
		dedupeKey: `email:reset:${user.id}:${bucket}`,
		maxAttempts: 3
	});
}

function sqlLower(col: SQLWrapper) {
	return sql`lower(${col})`;
}

export interface SendResult {
	ok: boolean;
	message: string;
}

/** Emails an invitation link right away; the inviter still sees the link if this fails. */
export async function sendInvitationEmail(
	to: string,
	link: string,
	opts: { inviterName: string; projectName?: string | null; expiresAt: Date }
): Promise<SendResult> {
	if (!emailEnabled()) return { ok: false, message: 'Email is not configured.' };
	const appName = getSettings().appName;
	const target = opts.projectName ? `the project “${opts.projectName}” on ${appName}` : appName;
	const { html, text } = renderEmail({
		appName,
		preheader: `${opts.inviterName} invited you to ${target}`,
		heading: `You’re invited to ${opts.projectName ?? appName}`,
		paragraphs: [
			`${opts.inviterName} invited you to join ${target}, where bugs, ideas and feedback are tracked.`,
			`The invitation works once and expires on ${opts.expiresAt.toISOString().slice(0, 10)}.`
		],
		action: { label: 'Accept invitation', url: link },
		footer: `You received this email because ${opts.inviterName} entered your address. If you weren’t expecting it, you can ignore it.`
	});
	return deliverNow({ to, subject: `${opts.inviterName} invited you to ${appName}`, html, text });
}

/** Sends a password reset link created by an administrator. */
export async function sendAdminResetEmail(userId: number, link: string): Promise<SendResult> {
	if (!emailEnabled()) return { ok: false, message: 'Email is not configured.' };
	const user = getDb().select().from(schema.users).where(eq(schema.users.id, userId)).get();
	if (!user?.email) return { ok: false, message: 'The user has no email address.' };
	const appName = getSettings().appName;
	const { html, text } = renderEmail({
		appName,
		heading: 'Reset your password',
		paragraphs: [
			`Hi ${user.displayName}, an administrator created a password reset link for your ${appName} account “${user.username}”.`,
			'The link works once and expires in 24 hours.'
		],
		action: { label: 'Choose a new password', url: link },
		footer: `If you did not expect this, contact your ${appName} administrator.`
	});
	return deliverNow({ to: user.email, subject: `Reset your ${appName} password`, html, text });
}

async function deliverNow(message: { to: string; subject: string; html: string; text: string }) {
	try {
		await sendMail(message);
		return { ok: true, message: `Email sent to ${message.to}` };
	} catch (err) {
		return {
			ok: false,
			message: err instanceof DeliveryError ? err.message : 'Sending the email failed.'
		};
	}
}

/** Sends a test message with the current configuration and records the result. */
export async function sendTestEmail(to: string): Promise<SendResult> {
	const cfg = effectiveSmtp();
	if (!cfg) return { ok: false, message: 'Email is not configured yet.' };
	const appName = getSettings().appName;
	const { html, text } = renderEmail({
		appName,
		heading: 'Email is working',
		paragraphs: [
			`This test message was sent by ${appName} through ${cfg.host}:${cfg.port} (${cfg.security === 'none' ? 'no encryption' : cfg.security.toUpperCase()}).`,
			'Notification emails will look like this.'
		],
		details: [
			['Sender', cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress],
			['Configured by', cfg.source === 'env' ? 'Environment variables' : 'Administration']
		],
		footer: 'Sent from Administration → Email.'
	});
	let result: SendResult;
	try {
		await sendMail({ to, subject: `${appName} test email`, html, text }, { ...cfg, enabled: true });
		result = { ok: true, message: `Test email sent to ${to}` };
	} catch (err) {
		result = {
			ok: false,
			message: err instanceof DeliveryError ? err.message : 'Sending the test email failed.'
		};
	}
	recordSmtpTest({ at: Date.now(), ...result });
	return result;
}
