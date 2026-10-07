import { and, eq } from 'drizzle-orm';
import {
	DEFAULT_EMAIL_PREFS,
	NOTIFICATION_TYPES,
	PRIORITY_META,
	STATUS_META,
	TYPE_META,
	type NotificationPrefs,
	type NotificationType,
	type TicketPriority,
	type TicketStatus,
	type TicketType
} from '../../shared/constants';
import { describeNotification } from '../../shared/notifications';
import { userCanViewProject } from '../authz';
import { config } from '../config';
import { randomId } from '../auth/tokens';
import { getDb, schema, type DB } from '../db';
import type { OutboundJob, User } from '../db/schema';
import { enqueue, registerHandler } from '../outbound/queue';
import { GROUPABLE, type NotifyInput } from '../services/notifications';
import { getSettings } from '../settings';
import { emailEnabled } from './config';
import { sendMail } from './mailer';
import { renderEmail, truncate, type EmailContent } from './template';

export function getEmailPrefs(user: Pick<User, 'emailPrefs'>): NotificationPrefs {
	return { ...DEFAULT_EMAIL_PREFS, ...(user.emailPrefs ?? {}) };
}

export function setEmailPrefs(userId: number, prefs: NotificationPrefs) {
	const clean = Object.fromEntries(
		NOTIFICATION_TYPES.map((t) => [t, !!prefs[t]])
	) as NotificationPrefs;
	getDb()
		.update(schema.users)
		.set({ emailPrefs: clean, updatedAt: new Date() })
		.where(eq(schema.users.id, userId))
		.run();
}

/** Absolute base URL for links in emails (APP_URL / admin setting, else ORIGIN). */
export function publicBaseUrl() {
	return (getSettings().appUrl || config.appUrl || '').replace(/\/$/, '');
}

/**
 * Queues notification emails for recipients who want email for this category. Runs inside the
 * action's transaction (nothing is sent for a rolled-back action). The job carries a snapshot of
 * the event; access and preferences are checked again when it is sent.
 *
 * Aggregation: like grouped in-app notifications, repeated comments/status/update/milestone
 * events on the same ticket produce at most one email per recipient per hour (dedupe key).
 */
export function queueNotificationEmails(
	tx: DB,
	recipients: { id: number; emailPrefs: NotificationPrefs | null; email: string }[],
	input: NotifyInput
) {
	if (!recipients.length || !emailEnabled()) return 0;
	const groupable =
		GROUPABLE.includes(input.type) && input.ticketId !== null && !input.data.internal;
	const hour = Math.floor(Date.now() / 3_600_000);
	let queued = 0;
	for (const user of recipients) {
		if (user.id === input.actorId || !user.email || !getEmailPrefs(user)[input.type]) continue;
		const event: EmailEvent = {
			template: 'notification',
			userId: user.id,
			type: input.type,
			projectId: input.project.id,
			ticketId: input.ticketId,
			actorId: input.actorId,
			data: input.data,
			summary: `${input.type} notification`
		};
		const ok = enqueue(
			{
				kind: 'email',
				payload: event as unknown as Record<string, unknown>,
				dedupeKey: groupable
					? `email:${user.id}:${input.type}:${input.ticketId}:${hour}`
					: `email:${user.id}:${input.type}:${randomId(8)}`,
				projectId: input.project.id
			},
			tx
		);
		if (ok) queued++;
	}
	return queued;
}

export interface EmailEvent {
	template: 'notification';
	userId: number;
	type: NotificationType;
	projectId: number;
	ticketId: number | null;
	actorId: number | null;
	data: Record<string, unknown>;
	summary: string;
}

function loadContext(event: EmailEvent) {
	const db = getDb();
	const project = db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.id, event.projectId))
		.get();
	const ticket = event.ticketId
		? db
				.select({
					number: schema.tickets.number,
					title: schema.tickets.title,
					status: schema.tickets.status,
					priority: schema.tickets.priority,
					type: schema.tickets.type
				})
				.from(schema.tickets)
				.where(eq(schema.tickets.id, event.ticketId))
				.get()
		: undefined;
	const actor = event.actorId
		? db
				.select({ name: schema.users.displayName })
				.from(schema.users)
				.where(eq(schema.users.id, event.actorId))
				.get()
		: undefined;
	return { project, ticket, actorName: actor?.name ?? null };
}

/** Builds the email for a notification event, or null if it must not be sent (any more). */
export function notificationEmail(event: EmailEvent) {
	const ctx = loadContext(event);
	if (!ctx.project) return null;
	const found = {
		n: { type: event.type, data: event.data },
		project: ctx.project,
		ticket: ctx.ticket ?? null,
		actorName: ctx.actorName
	};
	const user = getDb().select().from(schema.users).where(eq(schema.users.id, event.userId)).get();
	if (!user || user.status !== 'active' || !user.email) return null;
	if (!getEmailPrefs(user)[found.n.type]) return null;
	// Membership is checked again at send time: removed members get nothing from private projects.
	const membership = getDb()
		.select({ role: schema.projectMembers.role })
		.from(schema.projectMembers)
		.where(
			and(
				eq(schema.projectMembers.projectId, found.project.id),
				eq(schema.projectMembers.userId, user.id)
			)
		)
		.get();
	if (!userCanViewProject(user, found.project, membership?.role ?? null)) return null;
	const data = found.n.data;
	if (
		data.internal &&
		user.role !== 'admin' &&
		membership?.role !== 'owner' &&
		membership?.role !== 'moderator'
	)
		return null;

	const base = publicBaseUrl();
	const project = found.project;
	const key = project.key;
	const ticket = found.ticket?.number ? found.ticket : null;
	const ref = ticket ? `${key}-${ticket.number}` : null;
	const summary = describeNotification({
		type: found.n.type,
		data,
		actorName: found.actorName,
		ticketTitle: ticket?.title ?? null
	});
	const link = ticket
		? `${base}/p/${key.toLowerCase()}/tickets/${ticket.number}`
		: found.n.type === 'release'
			? `${base}/p/${key.toLowerCase()}/changelog`
			: `${base}/p/${key.toLowerCase()}`;
	const details: [string, string][] = [];
	if (ticket) {
		details.push(['Status', STATUS_META[ticket.status as TicketStatus]?.label ?? ticket.status]);
		details.push(['Type', TYPE_META[ticket.type as TicketType]?.label ?? ticket.type]);
		if (found.n.type === 'update' || found.n.type === 'assigned')
			details.push([
				'Priority',
				PRIORITY_META[ticket.priority as TicketPriority]?.label ?? ticket.priority
			]);
	}
	if (typeof data.note === 'string' && data.note && found.n.type === 'status')
		details.push(['Note', truncate(data.note, 200)]);
	const quote =
		!data.internal && typeof data.excerpt === 'string' && data.excerpt ? data.excerpt : undefined;
	const reason: Record<NotificationType, string> = {
		new_ticket: 'a ticket was submitted to a project you manage',
		comment: 'you follow this ticket',
		status: 'you follow this ticket',
		mention: 'you were mentioned',
		assigned: 'a ticket was assigned to you',
		update: 'you follow this ticket',
		release: 'a ticket you follow was released',
		milestone: 'you follow this ticket'
	};
	const appName = getSettings().appName;
	const content: EmailContent = {
		appName,
		preheader: summary,
		eyebrow: ref ? `${project.name} · ${ref}` : project.name,
		heading: ticket ? ticket.title : summary,
		paragraphs: ticket ? [`${summary}.`] : [],
		details,
		quote,
		action: base ? { label: ticket ? `View ${ref}` : 'Open in Tikket', url: link } : undefined,
		footer: `You received this email because ${reason[found.n.type]}. ${base ? `Change your email preferences at ${base}/settings/notifications` : 'Change your email preferences in your Tikket account settings'}.`
	};
	const subject = ticket ? `[${ref}] ${truncate(ticket.title, 90)} – ${summary}` : summary;
	return { to: user.email, subject, ...renderEmail(content) };
}

async function handleEmailJob(job: OutboundJob) {
	const p = job.payload as { template?: string; userId?: number };
	if (p.template === 'notification' && p.userId) {
		const message = notificationEmail(job.payload as unknown as EmailEvent);
		if (!message) return; // no longer allowed or wanted: nothing to send
		await sendMail(message);
		return;
	}
	if (p.template === 'password_reset' && p.userId) {
		const { passwordResetEmail } = await import('./account');
		const message = passwordResetEmail(p.userId);
		if (message) await sendMail(message);
		return;
	}
}

registerHandler('email', handleEmailJob);
