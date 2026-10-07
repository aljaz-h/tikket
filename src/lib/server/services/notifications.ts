import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { NotificationType } from '../../shared/constants';
import { userCanViewProject } from '../authz';
import { getDb, schema, type DB } from '../db';
import type { Project } from '../db/schema';
import { getNotificationPrefs } from './users';
import { queueNotificationEmails } from '../email/notifications';

export interface NotifyInput {
	type: NotificationType;
	project: Project;
	ticketId: number | null;
	actorId: number | null;
	data: Record<string, unknown>;
	/** Restrict recipients to project owners/moderators and administrators (internal notes). */
	staffOnly?: boolean;
	/** Deliver in-app even if the category is switched off (the user asked for it: reminders). */
	force?: boolean;
}

/**
 * Creates notifications for the given recipients, skipping the actor, inactive accounts,
 * users who opted out and anyone who can no longer view the project. Recipients who want email
 * for this category also get an email (queued in the same transaction, see email/notifications).
 */
export function notify(recipientIds: Iterable<number>, input: NotifyInput, tx: DB = getDb()) {
	const ids = [...new Set(recipientIds)].filter((id) => id !== input.actorId);
	if (!ids.length) return 0;
	const users = tx
		.select({
			id: schema.users.id,
			role: schema.users.role,
			status: schema.users.status,
			notificationPrefs: schema.users.notificationPrefs,
			emailPrefs: schema.users.emailPrefs,
			email: schema.users.email,
			memberRole: schema.projectMembers.role
		})
		.from(schema.users)
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.userId, schema.users.id),
				eq(schema.projectMembers.projectId, input.project.id)
			)
		)
		.where(inArray(schema.users.id, ids))
		.all();
	const eligible = users
		.filter((u) => u.status === 'active')
		.filter((u) => userCanViewProject(u, input.project, u.memberRole))
		.filter(
			(u) =>
				!input.staffOnly ||
				u.role === 'admin' ||
				u.memberRole === 'owner' ||
				u.memberRole === 'moderator'
		);
	// Email preferences are independent of in-app preferences.
	queueNotificationEmails(tx, eligible, input);
	const rows = eligible
		.filter((u) => input.force || getNotificationPrefs(u)[input.type])
		.map((u) => ({
			userId: u.id,
			type: input.type,
			projectId: input.project.id,
			ticketId: input.ticketId,
			actorId: input.actorId,
			data: input.data
		}));
	if (!rows.length) return 0;

	// Group repeated activity: while a user still has an unread notification of the same kind
	// for the same ticket from the last few hours, update it instead of adding another one.
	const groupable =
		GROUPABLE.includes(input.type) && input.ticketId !== null && !input.data.internal;
	const pending = groupable
		? new Map(
				tx
					.select({
						id: schema.notifications.id,
						userId: schema.notifications.userId,
						data: schema.notifications.data
					})
					.from(schema.notifications)
					.where(
						and(
							inArray(
								schema.notifications.userId,
								rows.map((r) => r.userId)
							),
							eq(schema.notifications.type, input.type),
							eq(schema.notifications.ticketId, input.ticketId!),
							isNull(schema.notifications.readAt),
							gt(schema.notifications.createdAt, new Date(Date.now() - GROUP_WINDOW_MS))
						)
					)
					.all()
					.map((n) => [n.userId, n])
			)
		: new Map<number, { id: number; data: Record<string, unknown> }>();
	const fresh = rows.filter((r) => !pending.has(r.userId));
	for (const r of rows) {
		const prev = pending.get(r.userId);
		if (!prev) continue;
		tx.update(schema.notifications)
			.set({
				actorId: r.actorId,
				createdAt: new Date(),
				data: { ...r.data, groupCount: Number(prev.data.groupCount ?? 1) + 1 }
			})
			.where(eq(schema.notifications.id, prev.id))
			.run();
	}
	if (fresh.length) tx.insert(schema.notifications).values(fresh).run();
	return rows.length;
}

/** Kinds of notifications that are merged per ticket while unread (never mentions/assignments). */
export const GROUPABLE: NotificationType[] = ['comment', 'status', 'update', 'milestone'];
const GROUP_WINDOW_MS = 6 * 60 * 60 * 1000;

export function followerIds(ticketId: number, tx: Pick<DB, 'select'> = getDb()): number[] {
	return tx
		.select({ id: schema.ticketFollowers.userId })
		.from(schema.ticketFollowers)
		.where(eq(schema.ticketFollowers.ticketId, ticketId))
		.all()
		.map((r) => r.id);
}

export function unreadCount(userId: number): number {
	return (
		getDb()
			.select({ n: sql<number>`count(*)` })
			.from(schema.notifications)
			.where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
			.get()?.n ?? 0
	);
}

export function listNotifications(
	userId: number,
	opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {}
) {
	const actor = alias(schema.users, 'actor');
	return getDb()
		.select({
			id: schema.notifications.id,
			type: schema.notifications.type,
			data: schema.notifications.data,
			readAt: schema.notifications.readAt,
			createdAt: schema.notifications.createdAt,
			projectKey: schema.projects.key,
			projectName: schema.projects.name,
			ticketNumber: schema.tickets.number,
			ticketTitle: schema.tickets.title,
			actorName: actor.displayName,
			actorAvatarId: actor.avatarId
		})
		.from(schema.notifications)
		.leftJoin(schema.projects, eq(schema.projects.id, schema.notifications.projectId))
		.leftJoin(schema.tickets, eq(schema.tickets.id, schema.notifications.ticketId))
		.leftJoin(actor, eq(actor.id, schema.notifications.actorId))
		.where(
			and(
				eq(schema.notifications.userId, userId),
				opts.unreadOnly ? isNull(schema.notifications.readAt) : undefined
			)
		)
		.orderBy(desc(schema.notifications.id))
		.limit(opts.limit ?? 50)
		.offset(opts.offset ?? 0)
		.all();
}

export function markRead(userId: number, ids: number[]) {
	if (!ids.length) return 0;
	return getDb()
		.update(schema.notifications)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(schema.notifications.userId, userId),
				inArray(schema.notifications.id, ids),
				isNull(schema.notifications.readAt)
			)
		)
		.run().changes;
}

export function markAllRead(userId: number) {
	return getDb()
		.update(schema.notifications)
		.set({ readAt: new Date() })
		.where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
		.run().changes;
}

/** Marks notifications about a ticket as read when the user opens it. */
export function markTicketRead(userId: number, ticketId: number) {
	return getDb()
		.update(schema.notifications)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(schema.notifications.userId, userId),
				eq(schema.notifications.ticketId, ticketId),
				isNull(schema.notifications.readAt)
			)
		)
		.run().changes;
}

export function pruneOldNotifications(days = 180) {
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	return getDb()
		.delete(schema.notifications)
		.where(
			sql`${schema.notifications.createdAt} < ${cutoff.getTime()} and ${schema.notifications.readAt} is not null`
		)
		.run().changes;
}
