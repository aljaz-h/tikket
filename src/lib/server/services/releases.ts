import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
	RELEASE_STATUSES,
	RESOLVED_STATUSES,
	STATUS_META,
	type ReleaseStatus,
	type TicketStatus
} from '../../shared/constants';
import { parseTicketReference } from '../../shared/workflow';
import type { Actor, ProjectAccess } from '../authz';
import { getDb, schema, type DB } from '../db';
import type { Release, Ticket } from '../db/schema';
import { followerIds, notify } from './notifications';
import { addProjectActivity } from './project-activity';
import { addActivity, getTicket } from './tickets';
import { ServiceError } from './users';

type ActiveActor = NonNullable<Actor>;
const t = schema.tickets;
const r = schema.changelogEntries;

const resolvedList = sql.join(
	RESOLVED_STATUSES.map((s) => sql`${s}`),
	sql`, `
);

export interface Progress {
	total: number;
	completed: number;
	resolved: number;
	/** Percentage of linked tickets that are completed; null when nothing is linked. */
	percent: number | null;
}

/**
 * Ticket counts per release or milestone in one grouped query (no N+1). Progress is always
 * derived from the tickets' current status – it is never stored.
 */
export function progressFor(column: 'release' | 'milestone', ids: number[]) {
	const out = new Map<number, Progress>();
	if (!ids.length) return out;
	const col = column === 'release' ? t.releaseId : t.milestoneId;
	const rows = getDb()
		.select({
			id: col,
			total: sql<number>`count(*)`,
			completed: sql<number>`sum(case when ${t.status} = 'completed' then 1 else 0 end)`,
			resolved: sql<number>`sum(case when ${t.status} in (${resolvedList}) then 1 else 0 end)`
		})
		.from(t)
		.where(inArray(col, ids))
		.groupBy(col)
		.all();
	for (const id of ids) out.set(id, { total: 0, completed: 0, resolved: 0, percent: null });
	for (const row of rows) {
		if (row.id === null) continue;
		out.set(row.id, {
			total: row.total,
			completed: row.completed ?? 0,
			resolved: row.resolved ?? 0,
			percent: row.total ? Math.round(((row.completed ?? 0) / row.total) * 100) : null
		});
	}
	return out;
}

function requireStaff(access: ProjectAccess) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can manage releases', 'form', 403);
}

const today = () => new Date().toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function listReleases(projectId: number, opts: { statuses?: ReleaseStatus[] } = {}) {
	const rows = getDb()
		.select()
		.from(r)
		.where(
			and(eq(r.projectId, projectId), opts.statuses ? inArray(r.status, opts.statuses) : undefined)
		)
		// Upcoming first by target date, released ones newest first.
		.orderBy(
			sql`case ${r.status} when 'in_progress' then 0 when 'planned' then 1 when 'released' then 2 else 3 end`,
			sql`case when ${r.status} = 'released' then null else coalesce(${r.targetDate}, '9999') end`,
			desc(r.releaseDate),
			desc(r.id)
		)
		.all();
	const progress = progressFor(
		'release',
		rows.map((x) => x.id)
	);
	return rows.map((x) => ({ ...x, progress: progress.get(x.id)! }));
}
export type ReleaseListItem = ReturnType<typeof listReleases>[number];

/** Releases tickets can still be assigned to. */
export function openReleases(projectId: number) {
	return getDb()
		.select({ id: r.id, version: r.version, status: r.status, targetDate: r.targetDate })
		.from(r)
		.where(and(eq(r.projectId, projectId), inArray(r.status, ['planned', 'in_progress'])))
		.orderBy(sql`coalesce(${r.targetDate}, '9999')`, asc(r.id))
		.all();
}

export function getRelease(projectId: number, id: number): Release | undefined {
	return getDb()
		.select()
		.from(r)
		.where(and(eq(r.id, id), eq(r.projectId, projectId)))
		.get();
}

export function releaseTickets(releaseId: number) {
	return getDb()
		.select({
			id: t.id,
			number: t.number,
			title: t.title,
			type: t.type,
			status: t.status,
			priority: t.priority,
			voteCount: t.voteCount
		})
		.from(t)
		.where(eq(t.releaseId, releaseId))
		.orderBy(
			desc(
				sql`case ${t.priority} when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end`
			),
			asc(t.number)
		)
		.all();
}

export interface ReleaseInput {
	version: string;
	summaryHtml: string;
	targetDate: string | null;
	status: ReleaseStatus;
}

function uniqueVersion(err: unknown): never {
	if (err instanceof Error && /UNIQUE constraint failed/.test(err.message))
		throw new ServiceError('A release with this name already exists in this project', 'version');
	throw err;
}

export function createRelease(actor: ActiveActor, access: ProjectAccess, input: ReleaseInput) {
	requireStaff(access);
	validate(input, 'create');
	try {
		return getDb().transaction((tx) => {
			const row = tx
				.insert(r)
				.values({
					projectId: access.project.id,
					version: input.version,
					summaryHtml: input.summaryHtml,
					targetDate: input.targetDate,
					releaseDate: input.targetDate ?? today(),
					status: input.status,
					published: false,
					createdById: actor.id
				})
				.returning()
				.get();
			addProjectActivity(tx, access.project.id, actor.id, 'release', row.id, 'created', {
				version: row.version
			});
			return row;
		});
	} catch (err) {
		uniqueVersion(err);
	}
}

function validate(input: ReleaseInput, mode: 'create' | 'update') {
	if (!input.version.trim() || input.version.length > 60)
		throw new ServiceError('Enter a version or release name (up to 60 characters)', 'version');
	if (input.targetDate && !DATE_RE.test(input.targetDate))
		throw new ServiceError('Enter a valid date', 'targetDate');
	if (!RELEASE_STATUSES.includes(input.status)) throw new ServiceError('Choose a status', 'status');
	if (input.status === 'released' && mode === 'create')
		throw new ServiceError('Create the release first, then publish it', 'status');
}

/** Edits name, notes, target date or status. Publishing has its own, reviewed flow. */
export function updateRelease(
	actor: ActiveActor,
	access: ProjectAccess,
	id: number,
	input: ReleaseInput
) {
	requireStaff(access);
	validate(input, 'update');
	const current = getRelease(access.project.id, id);
	if (!current) throw new ServiceError('Release not found', 'form', 404);
	const released = current.status === 'released';
	if (released && input.status !== 'released')
		throw new ServiceError('A published release cannot be moved back', 'status');
	if (!released && input.status === 'released')
		throw new ServiceError('Use “Publish release” to publish it', 'status');
	try {
		getDb().transaction((tx) => {
			tx.update(r)
				.set({
					version: input.version,
					summaryHtml: input.summaryHtml,
					targetDate: input.targetDate,
					status: input.status,
					releaseDate: released ? current.releaseDate : (input.targetDate ?? current.releaseDate),
					updatedAt: new Date()
				})
				.where(eq(r.id, id))
				.run();
			const pid = access.project.id;
			if (current.version !== input.version)
				addProjectActivity(tx, pid, actor.id, 'release', id, 'renamed', {
					from: current.version,
					to: input.version
				});
			if (current.status !== input.status)
				addProjectActivity(tx, pid, actor.id, 'release', id, 'status', {
					from: current.status,
					to: input.status
				});
			if (current.summaryHtml !== input.summaryHtml)
				addProjectActivity(tx, pid, actor.id, 'release', id, 'notes');
			if ((current.targetDate ?? null) !== input.targetDate)
				addProjectActivity(tx, pid, actor.id, 'release', id, 'edited', {
					fields: ['target date']
				});
		});
	} catch (err) {
		uniqueVersion(err);
	}
}

/** Deletes an unpublished release; its tickets simply lose their target release. */
export function deleteRelease(actor: ActiveActor, access: ProjectAccess, id: number) {
	requireStaff(access);
	const current = getRelease(access.project.id, id);
	if (!current) throw new ServiceError('Release not found', 'form', 404);
	if (current.status === 'released')
		throw new ServiceError(
			'Published releases are part of the changelog and cannot be deleted',
			'form'
		);
	getDb().transaction((tx) => {
		const linked = tx.select({ id: t.id }).from(t).where(eq(t.releaseId, id)).all();
		for (const ticket of linked)
			addActivity(tx, ticket.id, actor.id, 'release', { from: current.version, to: null });
		tx.update(t).set({ releaseId: null }).where(eq(t.releaseId, id)).run();
		tx.delete(r).where(eq(r.id, id)).run();
		addProjectActivity(tx, access.project.id, actor.id, 'release', id, 'deleted', {
			version: current.version
		});
	});
}

/** Release a ticket may be assigned to, checked against the ticket's own project. */
export function assignableRelease(tx: Pick<DB, 'select'>, projectId: number, releaseId: number) {
	const rel = tx
		.select({ id: r.id, version: r.version, status: r.status })
		.from(r)
		.where(and(eq(r.id, releaseId), eq(r.projectId, projectId)))
		.get();
	if (!rel) throw new ServiceError('That release does not exist in this project', 'release');
	if (rel.status !== 'planned' && rel.status !== 'in_progress')
		throw new ServiceError(`Release ${rel.version} is ${rel.status.replace('_', ' ')}`, 'release');
	return rel;
}

/** Sets or clears a ticket's target release (each ticket has at most one). */
export function setTicketRelease(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	releaseId: number | null
) {
	requireStaff(access);
	if (ticket.projectId !== access.project.id)
		throw new ServiceError('Ticket not found', 'form', 404);
	if (releaseId === ticket.releaseId) return;
	getDb().transaction(
		(tx) => {
			const to = releaseId ? assignableRelease(tx, ticket.projectId, releaseId) : null;
			const from = ticket.releaseId
				? tx.select({ version: r.version }).from(r).where(eq(r.id, ticket.releaseId)).get()
				: null;
			tx.update(t).set({ releaseId, updatedAt: new Date() }).where(eq(t.id, ticket.id)).run();
			addActivity(tx, ticket.id, actor.id, 'release', {
				from: from?.version ?? null,
				to: to?.version ?? null
			});
		},
		{ behavior: 'immediate' }
	);
}

/** Adds tickets by reference ("SPL-12") to a release from the release page. */
export function addTicketsToRelease(
	actor: ActiveActor,
	access: ProjectAccess,
	releaseId: number,
	references: string[]
) {
	requireStaff(access);
	const release = getRelease(access.project.id, releaseId);
	if (!release) throw new ServiceError('Release not found', 'form', 404);
	const tickets: Ticket[] = [];
	for (const ref of references) {
		const number = parseTicketReference(ref, access.project.key);
		const ticket = number ? getTicket(access.project.id, number) : undefined;
		if (!ticket) throw new ServiceError(`No ticket ${ref} in this project`, 'tickets');
		tickets.push(ticket);
	}
	let added = 0;
	getDb().transaction(
		(tx) => {
			assignableRelease(tx, access.project.id, releaseId);
			for (const ticket of tickets) {
				if (ticket.releaseId === releaseId) continue;
				const from = ticket.releaseId
					? tx.select({ version: r.version }).from(r).where(eq(r.id, ticket.releaseId)).get()
					: null;
				tx.update(t).set({ releaseId, updatedAt: new Date() }).where(eq(t.id, ticket.id)).run();
				addActivity(tx, ticket.id, actor.id, 'release', {
					from: from?.version ?? null,
					to: release.version
				});
				added++;
			}
			if (added)
				addProjectActivity(tx, access.project.id, actor.id, 'release', releaseId, 'tickets', {
					added
				});
		},
		{ behavior: 'immediate' }
	);
	return added;
}

/** Everything the publish review screen shows. */
export function publishReview(projectId: number, releaseId: number) {
	const release = getRelease(projectId, releaseId);
	if (!release) return null;
	const tickets = releaseTickets(releaseId);
	const unresolved = tickets.filter((x) => !STATUS_META[x.status as TicketStatus].resolved);
	return {
		release,
		tickets,
		unresolved,
		completed: tickets.filter((x) => x.status === 'completed').length
	};
}

/**
 * Publishes a release: sets the publication date, makes it a public changelog entry and notifies
 * followers of its tickets once each. Unresolved tickets are never completed automatically;
 * the owner may move them out of the release instead. Publishing twice is impossible: the status
 * is re-checked inside the write transaction.
 */
export function publishRelease(
	actor: ActiveActor,
	access: ProjectAccess,
	releaseId: number,
	opts: { detachUnresolved?: boolean; summaryHtml?: string } = {}
) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can publish releases', 'form', 403);
	return getDb().transaction(
		(tx) => {
			const release = tx
				.select()
				.from(r)
				.where(and(eq(r.id, releaseId), eq(r.projectId, access.project.id)))
				.get();
			if (!release) throw new ServiceError('Release not found', 'form', 404);
			if (release.status === 'released')
				throw new ServiceError('This release has already been published', 'form', 409);
			if (release.status === 'cancelled')
				throw new ServiceError('A cancelled release cannot be published', 'form');
			const linked = tx
				.select({ id: t.id, status: t.status, reporterId: t.reporterId })
				.from(t)
				.where(eq(t.releaseId, releaseId))
				.all();
			const unresolved = linked.filter((x) => !STATUS_META[x.status].resolved);
			let detached = 0;
			if (opts.detachUnresolved && unresolved.length) {
				tx.update(t)
					.set({ releaseId: null })
					.where(
						inArray(
							t.id,
							unresolved.map((x) => x.id)
						)
					)
					.run();
				for (const x of unresolved)
					addActivity(tx, x.id, actor.id, 'release', { from: release.version, to: null });
				detached = unresolved.length;
			}
			const now = new Date();
			tx.update(r)
				.set({
					status: 'released',
					published: true,
					releasedAt: now,
					releaseDate: now.toISOString().slice(0, 10),
					summaryHtml: opts.summaryHtml ?? release.summaryHtml,
					updatedAt: now
				})
				.where(eq(r.id, releaseId))
				.run();
			const completed = linked.filter((x) => x.status === 'completed');
			addProjectActivity(tx, access.project.id, actor.id, 'release', releaseId, 'published', {
				completed: completed.length,
				unresolved: unresolved.length,
				detached
			});
			// Followers (and reporters) of the shipped tickets hear about it once, not per ticket.
			const recipients = new Map<number, number>();
			for (const ticket of completed)
				for (const userId of [...followerIds(ticket.id, tx), ticket.reporterId])
					if (!recipients.has(userId)) recipients.set(userId, ticket.id);
			for (const [userId, ticketId] of recipients)
				notify(
					[userId],
					{
						type: 'release',
						project: access.project,
						ticketId,
						actorId: actor.id,
						data: { releaseId, version: release.version, count: completed.length }
					},
					tx
				);
			return { completed: completed.length, unresolved: unresolved.length, detached };
		},
		{ behavior: 'immediate' }
	);
}

/** Published releases with the tickets they shipped: the public changelog. */
export function listChangelog(projectId: number, limit?: number) {
	const db = getDb();
	let query = db
		.select()
		.from(r)
		.where(and(eq(r.projectId, projectId), eq(r.status, 'released')))
		.orderBy(desc(r.releaseDate), desc(r.id))
		.$dynamic();
	if (limit) query = query.limit(limit);
	const entries = query.all();
	if (!entries.length) return [];
	const tickets = db
		.select({
			releaseId: t.releaseId,
			id: t.id,
			number: t.number,
			title: t.title,
			type: t.type,
			status: t.status
		})
		.from(t)
		.where(
			and(
				inArray(
					t.releaseId,
					entries.map((e) => e.id)
				),
				eq(t.status, 'completed')
			)
		)
		.orderBy(asc(t.number))
		.all();
	return entries.map((e) => ({ ...e, tickets: tickets.filter((x) => x.releaseId === e.id) }));
}

/** The published release a ticket shipped in, if any (shown on the ticket page). */
export function shippedIn(ticket: Ticket) {
	if (!ticket.releaseId || ticket.status !== 'completed') return [];
	return getDb()
		.select({ id: r.id, version: r.version, releaseDate: r.releaseDate })
		.from(r)
		.where(and(eq(r.id, ticket.releaseId), eq(r.status, 'released')))
		.all();
}

/** Upcoming releases with progress for dashboards (staff). */
export function upcomingReleases(projectId: number, limit = 4) {
	return listReleases(projectId, { statuses: ['in_progress', 'planned'] }).slice(0, limit);
}
