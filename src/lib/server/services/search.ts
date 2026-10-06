import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { RESOLVED_STATUSES, TICKET_STATUSES, type TicketStatus } from '../../shared/constants';
import { toFtsQuery, type TicketFilters } from '../../shared/filters';
import { parseTicketReference } from '../../shared/workflow';
import { viewableProjectsCondition, type Actor } from '../authz';
import { getDb, schema } from '../db';

const t = schema.tickets;
const assignee = alias(schema.users, 'assignee');
const reporter = alias(schema.users, 'reporter');

const resolvedList = sql.join(
	RESOLVED_STATUSES.map((s) => sql`${s}`),
	sql`, `
);
const isResolvedExpr = sql`case when ${t.status} in (${resolvedList}) then 1 else 0 end`;
const priorityRank = sql`case ${t.priority} when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end`;

function dayStart(date: string) {
	return new Date(`${date}T00:00:00.000Z`);
}
function nextDay(date: string) {
	return new Date(dayStart(date).getTime() + 24 * 60 * 60 * 1000);
}

export function ftsCondition(q: string, mode: 'all' | 'any' = 'all'): SQL | undefined {
	const match = toFtsQuery(q, mode);
	if (!match) return undefined;
	return inArray(t.id, sql`(select rowid from tickets_fts where tickets_fts match ${match})`);
}

/** Restricts tickets to projects the actor can view. */
export function viewableTicketsCondition(actor: Actor): SQL | undefined {
	const cond = viewableProjectsCondition(actor);
	if (!cond) return undefined;
	return inArray(
		t.projectId,
		getDb().select({ id: schema.projects.id }).from(schema.projects).where(cond)
	);
}

export interface QueryOptions {
	scope: SQL | undefined;
	filters: TicketFilters;
	pageSize: number;
	/** Project key used to interpret "SPL-12" style searches within one project. */
	projectKey?: string;
	/** Resolve "me" in reporter/assignee filters. */
	actorId?: number;
	/** Exclude archived projects from cross-project listings. */
	excludeArchived?: boolean;
}

function filterConditions(opts: QueryOptions): (SQL | undefined)[] {
	const f = opts.filters;
	const conds: (SQL | undefined)[] = [opts.scope];
	if (f.q) {
		const number = opts.projectKey ? parseTicketReference(f.q, opts.projectKey) : null;
		const text = ftsCondition(f.q);
		conds.push(number ? or(eq(t.number, number), text) : (text ?? sql`0`));
	}
	if (f.status.length) conds.push(inArray(t.status, f.status));
	if (f.type.length) conds.push(inArray(t.type, f.type));
	if (f.priority.length) conds.push(inArray(t.priority, f.priority));
	if (f.reporter) {
		if (f.reporter === 'me' && opts.actorId) conds.push(eq(t.reporterId, opts.actorId));
		else
			conds.push(
				sql`${t.reporterId} = (select id from users where lower(username) = ${f.reporter.toLowerCase()})`
			);
	}
	if (f.assignee) {
		if (f.assignee === 'none') conds.push(isNull(t.assigneeId));
		else if (f.assignee === 'me' && opts.actorId) conds.push(eq(t.assigneeId, opts.actorId));
		else
			conds.push(
				sql`${t.assigneeId} = (select id from users where lower(username) = ${f.assignee.toLowerCase()})`
			);
	}
	for (const labelId of f.labels)
		conds.push(
			sql`exists (select 1 from ticket_label_assignments a where a.ticket_id = ${t.id} and a.label_id = ${labelId})`
		);
	if (f.createdFrom) conds.push(gte(t.createdAt, dayStart(f.createdFrom)));
	if (f.createdTo) conds.push(lt(t.createdAt, nextDay(f.createdTo)));
	if (f.updatedFrom) conds.push(gte(t.updatedAt, dayStart(f.updatedFrom)));
	if (f.updatedTo) conds.push(lt(t.updatedAt, nextDay(f.updatedTo)));
	if (opts.excludeArchived) conds.push(isNull(schema.projects.archivedAt));
	return conds;
}

function orderFor(sort: TicketFilters['sort']): SQL[] {
	switch (sort) {
		case 'recent':
			return [desc(t.updatedAt)];
		case 'newest':
			return [desc(t.createdAt)];
		case 'oldest':
			return [asc(t.createdAt)];
		case 'votes':
			return [desc(t.voteCount), desc(t.updatedAt)];
		case 'priority':
			return [asc(isResolvedExpr), desc(priorityRank), desc(t.updatedAt)];
		default:
			return [asc(isResolvedExpr), desc(t.updatedAt)];
	}
}

const listColumns = {
	id: t.id,
	number: t.number,
	title: t.title,
	type: t.type,
	status: t.status,
	priority: t.priority,
	voteCount: t.voteCount,
	commentCount: t.commentCount,
	createdAt: t.createdAt,
	updatedAt: t.updatedAt,
	completedAt: t.completedAt,
	projectId: t.projectId,
	projectKey: schema.projects.key,
	projectName: schema.projects.name,
	projectIcon: schema.projects.icon,
	projectColor: schema.projects.color,
	assignee: { id: assignee.id, displayName: assignee.displayName, avatarId: assignee.avatarId },
	reporter: { id: reporter.id, displayName: reporter.displayName, avatarId: reporter.avatarId }
};

function attachLabels<T extends { id: number }>(rows: T[]) {
	if (!rows.length)
		return rows.map((r) => ({ ...r, labels: [] as { id: number; name: string; color: string }[] }));
	const labels = getDb()
		.select({
			ticketId: schema.ticketLabelAssignments.ticketId,
			id: schema.ticketLabels.id,
			name: schema.ticketLabels.name,
			color: schema.ticketLabels.color
		})
		.from(schema.ticketLabelAssignments)
		.innerJoin(
			schema.ticketLabels,
			eq(schema.ticketLabels.id, schema.ticketLabelAssignments.labelId)
		)
		.where(
			inArray(
				schema.ticketLabelAssignments.ticketId,
				rows.map((r) => r.id)
			)
		)
		.all();
	return rows.map((r) => ({
		...r,
		labels: labels
			.filter((l) => l.ticketId === r.id)
			.map(({ id, name, color }) => ({ id, name, color }))
	}));
}

/** Paginated, filtered ticket list with labels (two queries – no N+1). */
export function queryTickets(opts: QueryOptions) {
	const db = getDb();
	const where = and(...filterConditions(opts));
	const total =
		db
			.select({ n: sql<number>`count(*)` })
			.from(t)
			.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
			.where(where)
			.get()?.n ?? 0;
	const pages = Math.max(1, Math.ceil(total / opts.pageSize));
	const page = Math.min(opts.filters.page, pages);
	const rows = db
		.select(listColumns)
		.from(t)
		.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
		.innerJoin(reporter, eq(reporter.id, t.reporterId))
		.leftJoin(assignee, eq(assignee.id, t.assigneeId))
		.where(where)
		.orderBy(...orderFor(opts.filters.sort))
		.limit(opts.pageSize)
		.offset((page - 1) * opts.pageSize)
		.all()
		.map((r) => ({ ...r, assignee: r.assignee?.id ? r.assignee : null }));
	return { rows: attachLabels(rows), total, page, pages };
}

export type TicketListRow = ReturnType<typeof queryTickets>['rows'][number];

/** Tickets grouped by status for the board view (capped per column). */
export function boardTickets(opts: Omit<QueryOptions, 'pageSize'>, perColumn = 60) {
	const db = getDb();
	const columns = {} as Record<TicketStatus, TicketListRow[]>;
	const totals = {} as Record<TicketStatus, number>;
	const statuses = opts.filters.status.length ? opts.filters.status : [...TICKET_STATUSES];
	for (const status of TICKET_STATUSES) {
		columns[status] = [];
		totals[status] = 0;
	}
	for (const status of statuses) {
		const filters = { ...opts.filters, status: [status] };
		const where = and(...filterConditions({ ...opts, filters, pageSize: perColumn }));
		totals[status] =
			db
				.select({ n: sql<number>`count(*)` })
				.from(t)
				.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
				.where(where)
				.get()?.n ?? 0;
		const rows = db
			.select(listColumns)
			.from(t)
			.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
			.innerJoin(reporter, eq(reporter.id, t.reporterId))
			.leftJoin(assignee, eq(assignee.id, t.assigneeId))
			.where(where)
			.orderBy(...orderFor(opts.filters.sort === 'updated' ? 'recent' : opts.filters.sort))
			.limit(perColumn)
			.all()
			.map((r) => ({ ...r, assignee: r.assignee?.id ? r.assignee : null }));
		columns[status] = attachLabels(rows);
	}
	return { columns, totals, statuses };
}

/**
 * Possible duplicates for a draft ticket, best matches first. Lightweight scoring on top of FTS5
 * BM25: title matches weigh 4× description matches, tickets of the same type and unresolved
 * tickets rank higher, and a few distinctive words of the description widen the search.
 * Duplicates themselves are skipped (their canonical ticket is shown instead). The caller must
 * have checked that the actor can view the project.
 */
export function similarTickets(
	projectId: number,
	title: string,
	opts: { text?: string; type?: string; limit?: number } = {}
) {
	const keywords = (opts.text ?? '')
		.toLowerCase()
		.match(/[\p{L}\p{N}_]{5,}/gu)
		?.filter((w, i, all) => all.indexOf(w) === i)
		.sort((a, b) => b.length - a.length)
		.slice(0, 6)
		.join(' ');
	const match = toFtsQuery(`${title} ${keywords ?? ''}`, 'any');
	if (!match) return [];
	const type = opts.type ?? '';
	return getDb().all<{
		number: number;
		title: string;
		status: TicketStatus;
		type: string;
		voteCount: number;
	}>(sql`
		select t.number as number, t.title as title, t.status as status, t.type as type, t.vote_count as voteCount
		from tickets_fts f
		join tickets t on t.id = f.rowid
		where tickets_fts match ${match} and t.project_id = ${projectId} and t.status <> 'duplicate'
		order by bm25(tickets_fts, 4.0, 1.0)
			- (case when t.type = ${type} then 1.5 else 0 end)
			- (case when t.status in ('open','planned','in_progress','on_hold') then 0.5 else 0 end)
		limit ${opts.limit ?? 5}
	`);
}

/** Quick search across every project the actor can view. */
export function globalSearch(actor: Actor, q: string, limit = 8) {
	const db = getDb();
	const text = ftsCondition(q);
	const refMatch = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(q.trim());
	const scope = viewableTicketsCondition(actor);
	const byRef = refMatch
		? and(eq(schema.projects.key, refMatch[1].toUpperCase()), eq(t.number, Number(refMatch[2])))
		: undefined;
	const cond = byRef ? (text ? or(byRef, text) : byRef) : text;
	const tickets = cond
		? db
				.select({
					number: t.number,
					title: t.title,
					status: t.status,
					type: t.type,
					projectKey: schema.projects.key,
					projectName: schema.projects.name
				})
				.from(t)
				.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
				.where(and(scope, cond))
				.orderBy(asc(isResolvedExpr), desc(t.updatedAt))
				.limit(limit)
				.all()
		: [];
	const term = `%${q.trim().toLowerCase()}%`;
	const projects = db
		.select({
			key: schema.projects.key,
			name: schema.projects.name,
			icon: schema.projects.icon,
			color: schema.projects.color
		})
		.from(schema.projects)
		.where(
			and(
				viewableProjectsCondition(actor),
				or(
					sql`lower(${schema.projects.name}) like ${term}`,
					sql`lower(${schema.projects.key}) like ${term}`
				)
			)
		)
		.limit(5)
		.all();
	return { tickets, projects };
}
