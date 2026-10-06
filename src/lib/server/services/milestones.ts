import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { MILESTONE_STATUSES, type MilestoneStatus } from '../../shared/constants';
import type { Actor, ProjectAccess } from '../authz';
import { getDb, schema, type DB } from '../db';
import type { Milestone, Ticket } from '../db/schema';
import { followerIds, notify } from './notifications';
import { addProjectActivity } from './project-activity';
import { progressFor } from './releases';
import { addActivity } from './tickets';
import { ServiceError } from './users';

type ActiveActor = NonNullable<Actor>;
const m = schema.milestones;
const t = schema.tickets;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireStaff(access: ProjectAccess) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can manage milestones', 'form', 403);
}

export function listMilestones(projectId: number, opts: { statuses?: MilestoneStatus[] } = {}) {
	const rows = getDb()
		.select()
		.from(m)
		.where(
			and(eq(m.projectId, projectId), opts.statuses ? inArray(m.status, opts.statuses) : undefined)
		)
		.orderBy(
			sql`case ${m.status} when 'open' then 0 when 'completed' then 1 else 2 end`,
			sql`coalesce(${m.targetDate}, '9999')`,
			asc(m.name)
		)
		.all();
	const progress = progressFor(
		'milestone',
		rows.map((x) => x.id)
	);
	return rows.map((x) => ({ ...x, progress: progress.get(x.id)! }));
}
export type MilestoneListItem = ReturnType<typeof listMilestones>[number];

export function getMilestone(projectId: number, id: number): Milestone | undefined {
	return getDb()
		.select()
		.from(m)
		.where(and(eq(m.id, id), eq(m.projectId, projectId)))
		.get();
}

export function milestoneTickets(milestoneId: number) {
	return getDb()
		.select({
			id: t.id,
			number: t.number,
			title: t.title,
			type: t.type,
			status: t.status,
			priority: t.priority
		})
		.from(t)
		.where(eq(t.milestoneId, milestoneId))
		.orderBy(asc(t.number))
		.all();
}

export interface MilestoneInput {
	name: string;
	description: string | null;
	targetDate: string | null;
}

function validate(input: MilestoneInput) {
	if (!input.name.trim() || input.name.length > 80)
		throw new ServiceError('Name the milestone (up to 80 characters)', 'name');
	if (input.description && input.description.length > 2000)
		throw new ServiceError('Keep the description under 2,000 characters', 'description');
	if (input.targetDate && !DATE_RE.test(input.targetDate))
		throw new ServiceError('Enter a valid date', 'targetDate');
}

function uniqueName(err: unknown): never {
	if (err instanceof Error && /UNIQUE constraint failed/.test(err.message))
		throw new ServiceError('A milestone with this name already exists', 'name');
	throw err;
}

export function createMilestone(actor: ActiveActor, access: ProjectAccess, input: MilestoneInput) {
	requireStaff(access);
	validate(input);
	try {
		return getDb().transaction((tx) => {
			const row = tx
				.insert(m)
				.values({ projectId: access.project.id, createdById: actor.id, ...input })
				.returning()
				.get();
			addProjectActivity(tx, access.project.id, actor.id, 'milestone', row.id, 'created', {
				name: row.name
			});
			return row;
		});
	} catch (err) {
		uniqueName(err);
	}
}

export function updateMilestone(
	actor: ActiveActor,
	access: ProjectAccess,
	id: number,
	input: MilestoneInput
) {
	requireStaff(access);
	validate(input);
	const current = getMilestone(access.project.id, id);
	if (!current) throw new ServiceError('Milestone not found', 'form', 404);
	try {
		getDb().transaction((tx) => {
			tx.update(m)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(m.id, id))
				.run();
			if (current.name !== input.name)
				addProjectActivity(tx, access.project.id, actor.id, 'milestone', id, 'renamed', {
					from: current.name,
					to: input.name
				});
			const fields = [
				(current.description ?? null) !== input.description && 'description',
				(current.targetDate ?? null) !== input.targetDate && 'target date'
			].filter(Boolean);
			if (fields.length)
				addProjectActivity(tx, access.project.id, actor.id, 'milestone', id, 'edited', { fields });
		});
	} catch (err) {
		uniqueName(err);
	}
}

/**
 * Completes, reopens or archives a milestone. Completing notifies the followers of its tickets
 * once each (respecting their "Milestones" preference). Tickets keep their milestone.
 */
export function setMilestoneStatus(
	actor: ActiveActor,
	access: ProjectAccess,
	id: number,
	status: MilestoneStatus
) {
	requireStaff(access);
	if (!MILESTONE_STATUSES.includes(status)) throw new ServiceError('Unknown status', 'status');
	const current = getMilestone(access.project.id, id);
	if (!current) throw new ServiceError('Milestone not found', 'form', 404);
	if (current.status === status) return;
	getDb().transaction(
		(tx) => {
			const now = new Date();
			tx.update(m)
				.set({
					status,
					completedAt:
						status === 'completed' ? now : status === 'open' ? null : current.completedAt,
					updatedAt: now
				})
				.where(eq(m.id, id))
				.run();
			const type =
				status === 'completed' ? 'completed' : status === 'open' ? 'reopened' : 'archived';
			addProjectActivity(tx, access.project.id, actor.id, 'milestone', id, type);
			if (status === 'completed') {
				const tickets = tx.select({ id: t.id }).from(t).where(eq(t.milestoneId, id)).all();
				const recipients = new Map<number, number>();
				for (const ticket of tickets)
					for (const userId of followerIds(ticket.id, tx))
						if (!recipients.has(userId)) recipients.set(userId, ticket.id);
				for (const [userId, ticketId] of recipients)
					notify(
						[userId],
						{
							type: 'milestone',
							project: access.project,
							ticketId,
							actorId: actor.id,
							data: { kind: 'completed', milestone: current.name, count: tickets.length }
						},
						tx
					);
			}
		},
		{ behavior: 'immediate' }
	);
}

/** A milestone tickets may be added to: same project and still open. */
export function assignableMilestone(tx: Pick<DB, 'select'>, projectId: number, id: number) {
	const row = tx
		.select({ id: m.id, name: m.name, status: m.status })
		.from(m)
		.where(and(eq(m.id, id), eq(m.projectId, projectId)))
		.get();
	if (!row) throw new ServiceError('That milestone does not exist in this project', 'milestone');
	if (row.status !== 'open')
		throw new ServiceError(`Milestone “${row.name}” is ${row.status}`, 'milestone');
	return row;
}

export function setTicketMilestone(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	milestoneId: number | null
) {
	requireStaff(access);
	if (ticket.projectId !== access.project.id)
		throw new ServiceError('Ticket not found', 'form', 404);
	if (milestoneId === ticket.milestoneId) return;
	getDb().transaction(
		(tx) => {
			const to = milestoneId ? assignableMilestone(tx, ticket.projectId, milestoneId) : null;
			const from = ticket.milestoneId
				? tx.select({ name: m.name }).from(m).where(eq(m.id, ticket.milestoneId)).get()
				: null;
			tx.update(t).set({ milestoneId, updatedAt: new Date() }).where(eq(t.id, ticket.id)).run();
			addActivity(tx, ticket.id, actor.id, 'milestone', {
				from: from?.name ?? null,
				to: to?.name ?? null
			});
			notify(
				followerIds(ticket.id, tx),
				{
					type: 'milestone',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data: { kind: 'moved', milestone: to?.name ?? null }
				},
				tx
			);
		},
		{ behavior: 'immediate' }
	);
}

/** Open milestones with progress for dashboards and pickers. */
export function activeMilestones(projectId: number, limit?: number) {
	const list = listMilestones(projectId, { statuses: ['open'] });
	return limit ? list.slice(0, limit) : list;
}
