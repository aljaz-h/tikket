import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	PRIORITY_META,
	STATUS_META,
	TYPE_META,
	type DiscordEvent,
	type TicketPriority,
	type TicketStatus,
	type TicketType,
	type WebhookEvent
} from '../../shared/constants';
import { randomId } from '../auth/tokens';
import { schema, type DB } from '../db';
import type { Project } from '../db/schema';
import { publicBaseUrl } from '../email/notifications';
import { enqueue } from '../outbound/queue';

/**
 * Project events for Discord and generic webhooks.
 *
 * Events are emitted inside the transaction of the action that caused them. For every enabled
 * destination subscribed to the event, one job is queued with the complete payload, built now:
 * later edits don't change what an event said, and the payload only contains what the project
 * owner (who configured the destination) can see anyway. Internal notes are never emitted.
 */

export const PAYLOAD_VERSION = '1';

export interface EventTicket {
	id: number;
	key: string;
	number: number;
	title: string;
	type: string;
	status: string;
	priority: string;
	url: string | null;
	description: string;
	reporter: { username: string; name: string } | null;
	assignee: { username: string; name: string } | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
}

export interface EventContext {
	ticket?: EventTicket;
	/** Extra event-specific data (changes, comment, release, milestone …). */
	[key: string]: unknown;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const DESCRIPTION_LIMIT = 2000;

function projectUrl(project: Pick<Project, 'key'>) {
	const base = publicBaseUrl();
	return base ? `${base}/p/${project.key.toLowerCase()}` : null;
}

/** Loads the public-facing snapshot of a ticket for an event payload. */
export function ticketSnapshot(tx: DB, ticketId: number): EventTicket | undefined {
	const reporter = alias(schema.users, 'reporter');
	const assignee = alias(schema.users, 'assignee');
	const row = tx
		.select({
			t: schema.tickets,
			key: schema.projects.key,
			reporterUsername: reporter.username,
			reporterName: reporter.displayName,
			assigneeUsername: assignee.username,
			assigneeName: assignee.displayName
		})
		.from(schema.tickets)
		.innerJoin(schema.projects, eq(schema.projects.id, schema.tickets.projectId))
		.leftJoin(reporter, eq(reporter.id, schema.tickets.reporterId))
		.leftJoin(assignee, eq(assignee.id, schema.tickets.assigneeId))
		.where(eq(schema.tickets.id, ticketId))
		.get();
	if (!row) return undefined;
	const t = row.t;
	const base = projectUrl({ key: row.key });
	const text = t.descriptionText.trim();
	return {
		id: t.id,
		key: `${row.key}-${t.number}`,
		number: t.number,
		title: t.title,
		type: t.type,
		status: t.status,
		priority: t.priority,
		url: base ? `${base}/tickets/${t.number}` : null,
		description:
			text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…` : text,
		reporter: row.reporterUsername
			? { username: row.reporterUsername, name: row.reporterName ?? row.reporterUsername }
			: null,
		assignee: row.assigneeUsername
			? { username: row.assigneeUsername, name: row.assigneeName ?? row.assigneeUsername }
			: null,
		created_at: t.createdAt.toISOString(),
		updated_at: t.updatedAt.toISOString(),
		completed_at: iso(t.completedAt)
	};
}

export function buildEnvelope(
	project: Pick<Project, 'id' | 'key' | 'name'>,
	event: WebhookEvent | 'ping',
	data: EventContext,
	id = `evt_${randomId(12)}`
) {
	return {
		version: PAYLOAD_VERSION,
		id,
		event,
		created_at: new Date().toISOString(),
		project: { id: project.id, key: project.key, name: project.name, url: projectUrl(project) },
		data
	};
}
export type Envelope = ReturnType<typeof buildEnvelope>;

// ── Discord ────────────────────────────────────────────────────────────────

/** Which Discord subscriptions an event matches. */
export function discordMatches(event: WebhookEvent, data: EventContext): DiscordEvent[] {
	const t = data.ticket;
	const out: DiscordEvent[] = [];
	const high = (p: unknown) => p === 'high' || p === 'critical';
	switch (event) {
		case 'ticket.created':
			out.push('new_ticket');
			if (t?.type === 'bug') out.push('new_bug');
			if (t?.type === 'feature') out.push('new_feature');
			if (high(t?.priority)) out.push('high_priority');
			break;
		case 'ticket.updated': {
			const p = data.priority as { from?: string; to?: string } | undefined;
			if (p && high(p.to) && !high(p.from)) out.push('high_priority');
			break;
		}
		case 'ticket.status_changed':
			out.push('status_changed');
			break;
		case 'ticket.completed':
			out.push('completed');
			break;
		case 'comment.created':
			out.push('public_comment');
			break;
		case 'release.published':
			out.push('release_published');
			break;
	}
	return out;
}

/** Escapes Discord markdown and neutralises mentions in user-provided text. */
export function discordText(value: string, max: number) {
	const clean = value
		// eslint-disable-next-line no-control-regex -- stripping control characters is the point
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const cut = clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
	return cut.replace(/([\\*_~`|>[\]()#-])/g, '\\$1').replace(/@/g, '@\u200b');
}

const plain = (value: string, max: number) => {
	const clean = value.replace(/\s+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const COLORS = { lime: 0xb8f779, red: 0xe5484d, amber: 0xf5a524, blue: 0x5b8def, grey: 0x8b9199 };

/** Compact Discord message (one embed) for an event. Mentions are disabled. */
export function discordMessage(
	project: Pick<Project, 'key' | 'name'>,
	event: WebhookEvent,
	data: EventContext,
	appName = 'Tikket'
) {
	const t = data.ticket;
	const fields: { name: string; value: string; inline: boolean }[] = [];
	const field = (name: string, value: string | null | undefined) => {
		if (value) fields.push({ name, value: discordText(value, 100), inline: true });
	};
	let heading = 'Update';
	let color = COLORS.lime;
	let description: string | undefined;
	let title: string | undefined;
	let url: string | null | undefined = t?.url;
	if (t) {
		title = plain(`${t.key} · ${t.title}`, 240);
		field('Project', project.name);
		field('Reporter', t.reporter?.name);
		field('Priority', PRIORITY_META[t.priority as TicketPriority]?.label ?? t.priority);
		field('Status', STATUS_META[t.status as TicketStatus]?.label ?? t.status);
	}
	const typeLabel = t ? (TYPE_META[t.type as TicketType]?.label ?? 'ticket') : '';
	switch (event) {
		case 'ticket.created':
			heading = `New ${typeLabel.toLowerCase()}`;
			color = t?.type === 'bug' ? COLORS.red : COLORS.lime;
			description = t?.description ? discordText(t.description, 300) : undefined;
			break;
		case 'ticket.updated':
			heading = 'Priority raised';
			color = COLORS.amber;
			break;
		case 'ticket.status_changed': {
			const from = STATUS_META[data.from as TicketStatus]?.label ?? String(data.from);
			const to = STATUS_META[data.to as TicketStatus]?.label ?? String(data.to);
			heading = 'Status changed';
			color = COLORS.blue;
			description = `${discordText(from, 40)} → **${discordText(to, 40)}**`;
			break;
		}
		case 'ticket.completed':
			heading = 'Completed';
			color = COLORS.lime;
			break;
		case 'comment.created': {
			const c = data.comment as { author?: { name: string }; body?: string; url?: string };
			heading = `New comment${c?.author ? ` by ${plain(c.author.name, 60)}` : ''}`;
			color = COLORS.grey;
			description = c?.body ? discordText(c.body, 300) : undefined;
			url = c?.url ?? url;
			break;
		}
		case 'release.published': {
			const r = data.release as { version: string; url?: string | null; ticket_count?: number };
			heading = 'Release published';
			title = plain(`${project.name} ${r?.version ?? ''}`, 240);
			url = r?.url;
			description = r?.ticket_count
				? `${r.ticket_count} completed ticket${r.ticket_count === 1 ? '' : 's'}`
				: undefined;
			break;
		}
		case 'milestone.completed': {
			const m = data.milestone as { name: string; url?: string | null };
			heading = 'Milestone completed';
			title = plain(m?.name ?? 'Milestone', 240);
			url = m?.url;
			break;
		}
	}
	return {
		username: plain(appName, 80),
		allowed_mentions: { parse: [] as string[] },
		embeds: [
			{
				author: { name: plain(`${appName} — ${heading}`, 250) },
				title,
				url: url || undefined,
				description,
				color,
				fields: fields.slice(0, 6),
				footer: { text: plain(`${project.name} (${project.key})`, 200) },
				timestamp: new Date().toISOString()
			}
		]
	};
}

// ── Emission ───────────────────────────────────────────────────────────────

/** Discord subscriptions an event can match at all (to skip building payloads early). */
const POSSIBLE_DISCORD: Record<WebhookEvent, DiscordEvent[]> = {
	'ticket.created': ['new_ticket', 'new_bug', 'new_feature', 'high_priority'],
	'ticket.updated': ['high_priority'],
	'ticket.status_changed': ['status_changed'],
	'ticket.assigned': [],
	'ticket.completed': ['completed'],
	'comment.created': ['public_comment'],
	'release.published': ['release_published'],
	'milestone.completed': []
};

/**
 * Emits a project event to every enabled destination subscribed to it (queued in the caller's
 * transaction). `build` runs only if at least one destination exists.
 */
export function emitProjectEvent(
	tx: DB,
	project: Pick<Project, 'id' | 'key' | 'name'>,
	event: WebhookEvent,
	build: () => EventContext | null
) {
	const hooks = tx
		.select({
			id: schema.projectHooks.id,
			kind: schema.projectHooks.kind,
			events: schema.projectHooks.events
		})
		.from(schema.projectHooks)
		.where(
			and(eq(schema.projectHooks.projectId, project.id), eq(schema.projectHooks.enabled, true))
		)
		.all();
	if (!hooks.length) return 0;
	const subscribed = hooks.filter((h) =>
		h.kind === 'webhook'
			? h.events.includes(event)
			: POSSIBLE_DISCORD[event].some((e) => h.events.includes(e))
	);
	if (!subscribed.length) return 0;
	const data = build();
	if (!data) return 0;
	const envelope = buildEnvelope(project, event, data);
	const matches = discordMatches(event, data);
	let queued = 0;
	for (const hook of hooks) {
		if (hook.kind === 'webhook') {
			if (!hook.events.includes(event)) continue;
			enqueue(
				{
					kind: 'webhook',
					payload: { envelope, summary: `${event} ${envelope.id}` },
					dedupeKey: `hook:${hook.id}:${envelope.id}`,
					projectId: project.id,
					hookId: hook.id
				},
				tx
			);
			queued++;
		} else {
			if (!matches.some((m) => hook.events.includes(m))) continue;
			enqueue(
				{
					kind: 'discord',
					payload: {
						event,
						eventId: envelope.id,
						message: discordMessage(project, event, data),
						summary: `${event} ${envelope.id}`
					},
					dedupeKey: `hook:${hook.id}:${envelope.id}`,
					projectId: project.id,
					hookId: hook.id
				},
				tx
			);
			queued++;
		}
	}
	return queued;
}
