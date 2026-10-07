import { and, asc, count, eq, gt, isNull, lte } from 'drizzle-orm';
import type { ProjectAccess } from '../authz';
import { accessForProject } from '../authz';
import { getDb, schema } from '../db';
import type { Ticket } from '../db/schema';
import { registerTickHook } from '../outbound/queue';
import { notify } from './notifications';
import { ServiceError } from './users';

/**
 * Personal ticket reminders ("remind me about this ticket"): one-off, private to the person who
 * set them, at most a few at a time. No recurrence and no scheduler – the delivery worker checks
 * for due reminders on its regular tick and turns each into an in-app notification (plus an
 * email when the person wants emails for "Other updates").
 */

export const MAX_ACTIVE_REMINDERS = 10;
const MAX_AHEAD_MS = 366 * 864e5;
const r = schema.ticketReminders;

export type ReminderPreset = 'tomorrow' | '3days' | 'week';

/** 09:00 local server time on the chosen day (presets) – predictable and not in the night. */
export function presetTime(preset: ReminderPreset, now = new Date()) {
	const days = preset === 'tomorrow' ? 1 : preset === '3days' ? 3 : 7;
	const d = new Date(now);
	d.setDate(d.getDate() + days);
	d.setHours(9, 0, 0, 0);
	return d;
}

export function createReminder(
	userId: number,
	access: ProjectAccess,
	ticket: Pick<Ticket, 'id' | 'projectId'>,
	remindAt: Date,
	note: string | null,
	now = Date.now()
) {
	if (!access.canView || ticket.projectId !== access.project.id)
		throw new ServiceError('Ticket not found', 'form', 404);
	if (Number.isNaN(remindAt.getTime()) || remindAt.getTime() <= now)
		throw new ServiceError('Choose a time in the future', 'remindAt');
	if (remindAt.getTime() - now > MAX_AHEAD_MS)
		throw new ServiceError('Reminders can be at most a year ahead', 'remindAt');
	const active =
		getDb()
			.select({ n: count() })
			.from(r)
			.where(and(eq(r.userId, userId), isNull(r.sentAt)))
			.get()?.n ?? 0;
	if (active >= MAX_ACTIVE_REMINDERS)
		throw new ServiceError(
			`You can have at most ${MAX_ACTIVE_REMINDERS} open reminders – remove one first`,
			'form'
		);
	return getDb()
		.insert(r)
		.values({ userId, ticketId: ticket.id, remindAt, note: note?.trim().slice(0, 200) || null })
		.returning()
		.get();
}

/** The caller's open reminders for one ticket. */
export function ticketReminders(userId: number, ticketId: number) {
	return getDb()
		.select({ id: r.id, remindAt: r.remindAt, note: r.note })
		.from(r)
		.where(and(eq(r.userId, userId), eq(r.ticketId, ticketId), isNull(r.sentAt)))
		.orderBy(asc(r.remindAt))
		.all();
}

export function cancelReminder(userId: number, id: number) {
	const deleted = getDb()
		.delete(r)
		.where(and(eq(r.id, id), eq(r.userId, userId), isNull(r.sentAt)))
		.run().changes;
	if (!deleted) throw new ServiceError('Reminder not found', 'form');
}

/** Sends due reminders (bounded batch). Returns how many were processed. */
export function processDueReminders(now = new Date(), limit = 50) {
	const due = getDb()
		.select({ reminder: r, ticket: schema.tickets, project: schema.projects, user: schema.users })
		.from(r)
		.innerJoin(schema.tickets, eq(schema.tickets.id, r.ticketId))
		.innerJoin(schema.projects, eq(schema.projects.id, schema.tickets.projectId))
		.innerJoin(schema.users, eq(schema.users.id, r.userId))
		.where(and(isNull(r.sentAt), lte(r.remindAt, now)))
		.orderBy(asc(r.remindAt))
		.limit(limit)
		.all();
	for (const { reminder, ticket, project, user } of due) {
		getDb().transaction((tx) => {
			// Claim first: a reminder is sent at most once even if two ticks overlap.
			const claimed = tx
				.update(r)
				.set({ sentAt: now })
				.where(and(eq(r.id, reminder.id), isNull(r.sentAt)))
				.run().changes;
			if (!claimed) return;
			// Access is checked again: someone who lost access gets nothing.
			if (user.status !== 'active' || !accessForProject(user, project).canView) return;
			notify(
				[user.id],
				{
					type: 'update',
					project,
					ticketId: ticket.id,
					actorId: null,
					data: { kind: 'reminder', title: ticket.title, message: reminder.note ?? undefined },
					force: true
				},
				tx
			);
		});
	}
	return due.length;
}

/** Upcoming reminders exist? (cheap check so the worker tick stays quiet) */
function hasDue(now: Date) {
	return !!getDb()
		.select({ id: r.id })
		.from(r)
		.where(and(isNull(r.sentAt), lte(r.remindAt, now)))
		.limit(1)
		.get();
}

registerTickHook(() => {
	const now = new Date();
	if (hasDue(now)) processDueReminders(now);
});

/** Removes sent reminders after 30 days. */
export function pruneReminders(now = Date.now()) {
	return getDb()
		.delete(r)
		.where(and(gt(r.sentAt, new Date(0)), lte(r.sentAt, new Date(now - 30 * 864e5))))
		.run().changes;
}
