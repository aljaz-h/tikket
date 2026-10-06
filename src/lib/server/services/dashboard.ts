import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { UNRESOLVED_STATUSES } from '../../shared/constants';
import { parseTicketFilters } from '../../shared/filters';
import type { Actor } from '../authz';
import { getDb, schema } from '../db';
import { queryTickets, viewableTicketsCondition } from './search';

const t = schema.tickets;

function recent(actor: Actor, scope: ReturnType<typeof and>, limit = 6, sort: 'recent' | 'updated' = 'recent') {
	const filters = { ...parseTicketFilters(new URLSearchParams()), sort };
	return queryTickets({ scope: and(viewableTicketsCondition(actor), scope), filters, pageSize: limit, actorId: actor?.id, excludeArchived: true }).rows;
}

export function userDashboard(actor: NonNullable<Actor>) {
	return {
		mine: recent(actor, eq(t.reporterId, actor.id), 6, 'updated'),
		following: recent(
			actor,
			and(
				sql`${t.id} in (select ticket_id from ticket_followers where user_id = ${actor.id})`,
				sql`${t.reporterId} != ${actor.id}`
			),
			6,
			'updated'
		),
		recentlyUpdated: recent(actor, undefined, 8)
	};
}

/** Projects the actor manages: all active projects for admins, owned/moderated ones otherwise. */
export function managedProjectIds(actor: NonNullable<Actor>): number[] {
	const db = getDb();
	if (actor.role === 'admin')
		return db.select({ id: schema.projects.id }).from(schema.projects).where(isNull(schema.projects.archivedAt)).all().map((r) => r.id);
	return db
		.select({ id: schema.projectMembers.projectId })
		.from(schema.projectMembers)
		.innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
		.where(
			and(
				eq(schema.projectMembers.userId, actor.id),
				inArray(schema.projectMembers.role, ['owner', 'moderator']),
				isNull(schema.projects.archivedAt)
			)
		)
		.all()
		.map((r) => r.id);
}

export function staffDashboard(actor: NonNullable<Actor>, projectIds: number[]) {
	const db = getDb();
	if (!projectIds.length) return null;
	const inScope = inArray(t.projectId, projectIds);
	const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const counts = db
		.select({
			open: sql<number>`sum(case when ${t.status} = 'open' then 1 else 0 end)`,
			inProgress: sql<number>`sum(case when ${t.status} = 'in_progress' then 1 else 0 end)`,
			planned: sql<number>`sum(case when ${t.status} = 'planned' then 1 else 0 end)`,
			completed30: sql<number>`sum(case when ${t.status} = 'completed' and ${t.completedAt} >= ${monthAgo.getTime()} then 1 else 0 end)`,
			unassigned: sql<number>`sum(case when ${t.assigneeId} is null and ${t.status} in ('open','planned','in_progress') then 1 else 0 end)`
		})
		.from(t)
		.where(inScope)
		.get();

	const filters = parseTicketFilters(new URLSearchParams());
	const base = { actorId: actor.id, excludeArchived: true };
	const needsReview = queryTickets({ ...base, scope: and(inScope, eq(t.status, 'open')), filters: { ...filters, sort: 'newest' }, pageSize: 8 }).rows;
	const mostVoted = queryTickets({
		...base,
		scope: and(inScope, inArray(t.status, UNRESOLVED_STATUSES), sql`${t.voteCount} > 0`),
		filters: { ...filters, sort: 'votes' },
		pageSize: 6
	}).rows;
	const recentlyCompleted = queryTickets({
		...base,
		scope: and(inScope, eq(t.status, 'completed'), gte(t.completedAt, monthAgo)),
		filters: { ...filters, sort: 'recent' },
		pageSize: 6
	}).rows;

	const actorUser = alias(schema.users, 'actor');
	const activity = db
		.select({
			id: schema.ticketActivity.id,
			type: schema.ticketActivity.type,
			data: schema.ticketActivity.data,
			createdAt: schema.ticketActivity.createdAt,
			actorName: actorUser.displayName,
			actorAvatarId: actorUser.avatarId,
			ticketNumber: t.number,
			ticketTitle: t.title,
			projectKey: schema.projects.key
		})
		.from(schema.ticketActivity)
		.innerJoin(t, eq(t.id, schema.ticketActivity.ticketId))
		.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
		.leftJoin(actorUser, eq(actorUser.id, schema.ticketActivity.actorId))
		.where(inScope)
		.orderBy(desc(schema.ticketActivity.id))
		.limit(12)
		.all();

	return {
		counts: {
			open: counts?.open ?? 0,
			inProgress: counts?.inProgress ?? 0,
			planned: counts?.planned ?? 0,
			completed30: counts?.completed30 ?? 0,
			unassigned: counts?.unassigned ?? 0
		},
		needsReview,
		mostVoted,
		recentlyCompleted,
		activity
	};
}

export function roadmap(projectId: number) {
	const db = getDb();
	const columns = ['planned', 'in_progress', 'completed'] as const;
	const result = {} as Record<(typeof columns)[number], { number: number; title: string; type: string; status: string; voteCount: number; completedAt: Date | null; updatedAt: Date }[]>;
	for (const status of columns) {
		result[status] = db
			.select({ number: t.number, title: t.title, type: t.type, status: t.status, voteCount: t.voteCount, completedAt: t.completedAt, updatedAt: t.updatedAt })
			.from(t)
			.where(and(eq(t.projectId, projectId), eq(t.status, status)))
			.orderBy(...(status === 'completed' ? [desc(t.completedAt)] : [desc(t.voteCount), desc(t.updatedAt)]))
			.limit(status === 'completed' ? 30 : 100)
			.all();
	}
	return result;
}

export function projectStats(projectId: number) {
	return getDb()
		.select({
			open: sql<number>`coalesce(sum(case when ${t.status} = 'open' then 1 else 0 end), 0)`,
			planned: sql<number>`coalesce(sum(case when ${t.status} = 'planned' then 1 else 0 end), 0)`,
			inProgress: sql<number>`coalesce(sum(case when ${t.status} = 'in_progress' then 1 else 0 end), 0)`,
			completed: sql<number>`coalesce(sum(case when ${t.status} = 'completed' then 1 else 0 end), 0)`,
			total: sql<number>`count(*)`
		})
		.from(t)
		.where(eq(t.projectId, projectId))
		.get()!;
}
