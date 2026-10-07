import { and, eq, inArray } from 'drizzle-orm';
import {
	STATUS_META,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	type NotificationType,
	type TicketPriority,
	type TicketStatus
} from '../../shared/constants';
import { statusEffect } from '../../shared/workflow';
import type { Actor, ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Ticket } from '../db/schema';
import { followerIds, notify } from './notifications';
import { isAssignable } from './projects';
import { addActivity, emitStatusEvents } from './tickets';
import { emitProjectEvent, ticketSnapshot } from '../integrations/events';
import { assignableMilestone } from './milestones';
import { assignableRelease } from './releases';
import { ServiceError } from './users';
import { checkTransition, workflowFor } from './workflow';
import { fireStatusTriggers, fireTrigger } from '../automations/triggers';

type ActiveActor = NonNullable<Actor>;

export const BULK_LIMIT = 100;

export type BulkOperation =
	| { kind: 'status'; status: TicketStatus }
	| { kind: 'priority'; priority: TicketPriority }
	| { kind: 'assign'; assigneeId: number | null }
	| { kind: 'addLabel'; labelId: number }
	| { kind: 'removeLabel'; labelId: number }
	| { kind: 'release'; releaseId: number | null }
	| { kind: 'milestone'; milestoneId: number | null };

export interface BulkResult {
	updated: number[];
	skipped: { number: number; reason: string }[];
}

/** Parses the bulk form (`change` = "operation:value", repeated `ticket`) into an operation. */
export function parseBulkForm(form: FormData): { op: BulkOperation; numbers: number[] } {
	const numbers = [
		...new Set(
			form
				.getAll('ticket')
				.map((v) => Number(v))
				.filter((n) => Number.isInteger(n) && n > 0)
		)
	];
	if (!numbers.length) throw new ServiceError('Select at least one ticket', 'bulk');
	if (numbers.length > BULK_LIMIT)
		throw new ServiceError(`Select at most ${BULK_LIMIT} tickets at a time`, 'bulk');
	const [operation, value = ''] = String(form.get('change') ?? '').split(':');
	const id = Number(value);
	switch (operation) {
		case 'status':
			if (!TICKET_STATUSES.includes(value as TicketStatus))
				throw new ServiceError('Choose a status', 'bulk');
			if (value === 'duplicate')
				throw new ServiceError(
					'Mark duplicates one at a time – each needs its original ticket',
					'bulk'
				);
			return { op: { kind: 'status', status: value as TicketStatus }, numbers };
		case 'priority':
			if (!TICKET_PRIORITIES.includes(value as TicketPriority))
				throw new ServiceError('Choose a priority', 'bulk');
			return { op: { kind: 'priority', priority: value as TicketPriority }, numbers };
		case 'assign':
			if (value !== 'none' && !(Number.isInteger(id) && id > 0))
				throw new ServiceError('Choose an assignee', 'bulk');
			return { op: { kind: 'assign', assigneeId: value === 'none' ? null : id }, numbers };
		case 'addLabel':
		case 'removeLabel':
			if (!(Number.isInteger(id) && id > 0)) throw new ServiceError('Choose a label', 'bulk');
			return { op: { kind: operation as 'addLabel', labelId: id }, numbers };
		case 'release':
			if (value !== 'none' && !(Number.isInteger(id) && id > 0))
				throw new ServiceError('Choose a release', 'bulk');
			return { op: { kind: 'release', releaseId: value === 'none' ? null : id }, numbers };
		case 'milestone':
			if (value !== 'none' && !(Number.isInteger(id) && id > 0))
				throw new ServiceError('Choose a milestone', 'bulk');
			return { op: { kind: 'milestone', milestoneId: value === 'none' ? null : id }, numbers };
		default:
			throw new ServiceError('Choose an action', 'bulk');
	}
}

/**
 * Applies one change to many tickets of a project in a single transaction. Every ticket is
 * looked up within the project the caller is authorised for, so numbers from other projects
 * can never be touched; tickets that do not need the change are skipped with a reason.
 *
 * Each changed ticket gets its own activity entry (marked `bulk`), but notifications are
 * grouped: each recipient receives at most one notification per bulk operation.
 */
export function bulkUpdate(
	actor: ActiveActor,
	access: ProjectAccess,
	numbers: number[],
	op: BulkOperation
): BulkResult {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can bulk edit tickets', 'bulk', 403);
	const projectId = access.project.id;
	const db = getDb();
	const workflow = workflowFor(access.project);

	let label: { id: number; name: string } | undefined;
	if (op.kind === 'addLabel' || op.kind === 'removeLabel') {
		label = db
			.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
			.from(schema.ticketLabels)
			.where(
				and(eq(schema.ticketLabels.id, op.labelId), eq(schema.ticketLabels.projectId, projectId))
			)
			.get();
		if (!label) throw new ServiceError('That label does not exist in this project', 'bulk');
	}
	let assigneeName: string | undefined;
	if (op.kind === 'assign' && op.assigneeId !== null) {
		if (!isAssignable(projectId, op.assigneeId))
			throw new ServiceError('Tickets can only be assigned to project staff', 'bulk');
		assigneeName = db
			.select({ displayName: schema.users.displayName })
			.from(schema.users)
			.where(eq(schema.users.id, op.assigneeId))
			.get()?.displayName;
	}

	return db.transaction(
		(tx) => {
			// Target release / milestone: same project and still open (re-checked in the transaction).
			const release =
				op.kind === 'release' && op.releaseId !== null
					? assignableRelease(tx, projectId, op.releaseId)
					: null;
			const milestone =
				op.kind === 'milestone' && op.milestoneId !== null
					? assignableMilestone(tx, projectId, op.milestoneId)
					: null;
			const names = (column: 'release' | 'milestone', ids: (number | null)[]) => {
				const wanted = [...new Set(ids.filter((x): x is number => x !== null))];
				if (!wanted.length) return new Map<number, string>();
				const rows =
					column === 'release'
						? tx
								.select({ id: schema.changelogEntries.id, name: schema.changelogEntries.version })
								.from(schema.changelogEntries)
								.where(inArray(schema.changelogEntries.id, wanted))
								.all()
						: tx
								.select({ id: schema.milestones.id, name: schema.milestones.name })
								.from(schema.milestones)
								.where(inArray(schema.milestones.id, wanted))
								.all();
				return new Map(rows.map((row) => [row.id, row.name]));
			};
			const tickets = tx
				.select()
				.from(schema.tickets)
				.where(
					and(eq(schema.tickets.projectId, projectId), inArray(schema.tickets.number, numbers))
				)
				.all();
			const byNumber = new Map(tickets.map((t) => [t.number, t]));
			const result: BulkResult = { updated: [], skipped: [] };
			// recipient → tickets they would hear about (grouped into one notification each)
			const grouped = new Map<number, Ticket[]>();
			const queue = (ids: number[], t: Ticket) => {
				for (const id of new Set(ids)) grouped.set(id, [...(grouped.get(id) ?? []), t]);
			};
			const labelled =
				label &&
				new Set(
					tx
						.select({ ticketId: schema.ticketLabelAssignments.ticketId })
						.from(schema.ticketLabelAssignments)
						.where(eq(schema.ticketLabelAssignments.labelId, label.id))
						.all()
						.map((r) => r.ticketId)
				);
			const now = new Date();
			const previous =
				op.kind === 'release'
					? names(
							'release',
							tickets.map((x) => x.releaseId)
						)
					: op.kind === 'milestone'
						? names(
								'milestone',
								tickets.map((x) => x.milestoneId)
							)
						: new Map<number, string>();

			for (const number of numbers) {
				const t = byNumber.get(number);
				if (!t) {
					result.skipped.push({ number, reason: 'not found in this project' });
					continue;
				}
				switch (op.kind) {
					case 'status': {
						if (t.status === op.status) {
							result.skipped.push({ number, reason: 'already has this status' });
							continue;
						}
						const blocked = checkTransition(workflow, t.status, op.status, null);
						if (blocked) {
							result.skipped.push({
								number,
								reason: blocked.startsWith('A note')
									? 'needs a note (change it on the ticket)'
									: 'transition not allowed'
							});
							continue;
						}
						const resolved = STATUS_META[op.status].resolved;
						tx.update(schema.tickets)
							.set({
								status: op.status,
								duplicateOfId: null,
								completedAt: op.status === 'completed' ? now : resolved ? t.completedAt : null,
								closedAt: resolved ? now : null,
								updatedAt: now
							})
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, 'status', {
							from: t.status,
							to: op.status,
							effect: statusEffect(t.status, op.status),
							bulk: true
						});
						queue([...followerIds(t.id, tx), t.reporterId], t);
						emitStatusEvents(tx, access.project, t.id, t.status, op.status, { bulk: true });
						fireStatusTriggers(tx, projectId, t.id, t.status, op.status);
						break;
					}
					case 'priority': {
						if (t.priority === op.priority) {
							result.skipped.push({ number, reason: 'already has this priority' });
							continue;
						}
						tx.update(schema.tickets)
							.set({ priority: op.priority, updatedAt: now })
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, 'priority', {
							from: t.priority,
							to: op.priority,
							bulk: true
						});
						emitProjectEvent(tx, access.project, 'ticket.updated', () => ({
							ticket: ticketSnapshot(tx, t.id),
							changes: ['priority'],
							priority: { from: t.priority, to: op.priority },
							bulk: true
						}));
						fireTrigger(tx, projectId, 'ticket.priority_changed', t.id, {
							from: t.priority,
							to: op.priority
						});
						break;
					}
					case 'assign': {
						if (t.assigneeId === op.assigneeId) {
							result.skipped.push({
								number,
								reason: op.assigneeId ? 'already assigned to them' : 'already unassigned'
							});
							continue;
						}
						tx.update(schema.tickets)
							.set({ assigneeId: op.assigneeId, updatedAt: now })
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, op.assigneeId ? 'assigned' : 'unassigned', {
							assigneeId: op.assigneeId,
							assigneeName,
							bulk: true
						});
						emitProjectEvent(tx, access.project, 'ticket.assigned', () => ({
							ticket: ticketSnapshot(tx, t.id),
							bulk: true
						}));
						fireTrigger(tx, projectId, 'ticket.assignee_changed', t.id, {
							from: t.assigneeId,
							to: op.assigneeId
						});
						if (op.assigneeId) {
							tx.insert(schema.ticketFollowers)
								.values({ ticketId: t.id, userId: op.assigneeId })
								.onConflictDoNothing()
								.run();
							queue([op.assigneeId], t);
						}
						break;
					}
					case 'addLabel':
					case 'removeLabel': {
						const has = labelled!.has(t.id);
						if (op.kind === 'addLabel' ? has : !has) {
							result.skipped.push({
								number,
								reason: op.kind === 'addLabel' ? 'already has the label' : 'does not have the label'
							});
							continue;
						}
						if (op.kind === 'addLabel')
							tx.insert(schema.ticketLabelAssignments)
								.values({ ticketId: t.id, labelId: label!.id })
								.run();
						else
							tx.delete(schema.ticketLabelAssignments)
								.where(
									and(
										eq(schema.ticketLabelAssignments.ticketId, t.id),
										eq(schema.ticketLabelAssignments.labelId, label!.id)
									)
								)
								.run();
						tx.update(schema.tickets)
							.set({ updatedAt: now })
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, 'labels', {
							added: op.kind === 'addLabel' ? [label!.name] : [],
							removed: op.kind === 'removeLabel' ? [label!.name] : [],
							removedCount: op.kind === 'removeLabel' ? 1 : 0,
							bulk: true
						});
						fireTrigger(
							tx,
							projectId,
							op.kind === 'addLabel' ? 'ticket.label_added' : 'ticket.label_removed',
							t.id,
							{ labelId: label!.id }
						);
						break;
					}
					case 'release': {
						if (t.releaseId === op.releaseId) {
							result.skipped.push({
								number,
								reason: op.releaseId ? 'already in this release' : 'has no release'
							});
							continue;
						}
						tx.update(schema.tickets)
							.set({ releaseId: op.releaseId, updatedAt: now })
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, 'release', {
							from: t.releaseId ? (previous.get(t.releaseId) ?? null) : null,
							to: release?.version ?? null,
							bulk: true
						});
						if (op.releaseId)
							fireTrigger(tx, projectId, 'ticket.release_assigned', t.id, {
								releaseId: op.releaseId
							});
						break;
					}
					case 'milestone': {
						if (t.milestoneId === op.milestoneId) {
							result.skipped.push({
								number,
								reason: op.milestoneId ? 'already in this milestone' : 'has no milestone'
							});
							continue;
						}
						tx.update(schema.tickets)
							.set({ milestoneId: op.milestoneId, updatedAt: now })
							.where(eq(schema.tickets.id, t.id))
							.run();
						addActivity(tx, t.id, actor.id, 'milestone', {
							from: t.milestoneId ? (previous.get(t.milestoneId) ?? null) : null,
							to: milestone?.name ?? null,
							bulk: true
						});
						if (op.milestoneId)
							fireTrigger(tx, projectId, 'ticket.milestone_assigned', t.id, {
								milestoneId: op.milestoneId
							});
						queue(followerIds(t.id, tx), t);
						break;
					}
				}
				result.updated.push(number);
			}

			// One notification per recipient, pointing at their first affected ticket.
			const type: NotificationType =
				op.kind === 'assign' ? 'assigned' : op.kind === 'milestone' ? 'milestone' : 'status';
			for (const [userId, list] of grouped) {
				notify(
					[userId],
					{
						type,
						project: access.project,
						ticketId: list[0].id,
						actorId: actor.id,
						data:
							op.kind === 'status'
								? { to: op.status, bulkCount: list.length }
								: op.kind === 'milestone'
									? { kind: 'moved', milestone: milestone?.name ?? null, bulkCount: list.length }
									: { bulkCount: list.length }
					},
					tx
				);
			}
			return result;
		},
		{ behavior: 'immediate' }
	);
}
