import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
	STATUS_META,
	type TicketContext,
	type TicketEnvironment,
	type TicketPriority,
	type TicketStatus,
	type TicketType
} from '../../shared/constants';
import { parseTicketReference, statusEffect, validateStatusChange } from '../../shared/workflow';
import { canEditTicket, type Actor, type ProjectAccess } from '../authz';
import { getDb, schema, type DB } from '../db';
import type { Ticket } from '../db/schema';
import { getSettings } from '../settings';
import { pendingAttachmentsFor, removeFiles } from '../uploads';
import { followerIds, notify } from './notifications';
import { isAssignable, projectStaffIds } from './projects';
import { ServiceError } from './users';
import { saveTemplateResponse, type TemplateResponseInput } from './templates';
import { shippedIn } from './releases';
import { checkTransition, workflowFor } from './workflow';
import { fireStatusTriggers, fireTrigger, fireVoteThreshold } from '../automations/triggers';
import { emitProjectEvent, ticketSnapshot } from '../integrations/events';

type ActiveActor = NonNullable<Actor>;

export function addActivity(
	tx: DB,
	ticketId: number,
	actorId: number | null,
	type: string,
	data: Record<string, unknown> = {}
) {
	tx.insert(schema.ticketActivity).values({ ticketId, actorId, type, data }).run();
}

/**
 * Atomically reserves the next ticket number for a project. A single UPDATE … RETURNING
 * inside the write transaction – never MAX(number) + 1.
 */
export function allocateTicketNumber(tx: DB, projectId: number): number {
	const row = tx
		.update(schema.projects)
		.set({ ticketCounter: sql`${schema.projects.ticketCounter} + 1` })
		.where(eq(schema.projects.id, projectId))
		.returning({ n: schema.projects.ticketCounter })
		.get();
	if (!row) throw new ServiceError('Project not found', 'form', 404);
	return row.n;
}

export function getTicket(projectId: number, number: number): Ticket | undefined {
	if (!Number.isInteger(number) || number < 1) return undefined;
	return getDb()
		.select()
		.from(schema.tickets)
		.where(and(eq(schema.tickets.projectId, projectId), eq(schema.tickets.number, number)))
		.get();
}

function attachPending(
	tx: DB,
	actorId: number,
	ids: string[],
	target: { projectId: number; ticketId: number; commentId?: number }
) {
	const pending = pendingAttachmentsFor(actorId, ids);
	if (!pending.length) return 0;
	tx.update(schema.attachments)
		.set({
			projectId: target.projectId,
			ticketId: target.ticketId,
			commentId: target.commentId ?? null,
			kind: target.commentId ? 'comment' : 'ticket',
			attachedAt: new Date()
		})
		.where(
			and(
				inArray(
					schema.attachments.id,
					pending.map((p) => p.id)
				),
				isNull(schema.attachments.attachedAt)
			)
		)
		.run();
	return pending.length;
}

export function ticketAttachmentCount(ticketId: number, tx: Pick<DB, 'select'> = getDb()): number {
	return (
		tx
			.select({ n: sql<number>`count(*)` })
			.from(schema.attachments)
			.where(and(eq(schema.attachments.ticketId, ticketId), isNull(schema.attachments.deletedAt)))
			.get()?.n ?? 0
	);
}

export interface TicketInput {
	type: TicketType;
	title: string;
	descriptionHtml: string;
	descriptionText: string;
	context: TicketContext;
}

export interface CreateTicketExtras {
	source?: 'web' | 'widget' | 'api' | 'import';
	environment?: TicketEnvironment | null;
	template?: TemplateResponseInput | null;
}

export function createTicket(
	actor: ActiveActor,
	access: ProjectAccess,
	input: TicketInput,
	attachmentIds: string[] = [],
	extras: CreateTicketExtras = {}
): Ticket {
	if (!access.canSubmit)
		throw new ServiceError('You cannot submit tickets to this project', 'form', 403);
	if (attachmentIds.length && !access.canAttach)
		throw new ServiceError('Attachments are disabled for this project', 'attachments');
	const max = getSettings().maxAttachmentsPerTicket;
	if (attachmentIds.length > max)
		throw new ServiceError(`You can attach up to ${max} images per ticket`, 'attachments');

	const project = access.project;
	const workflow = workflowFor(project);
	const ticket = getDb().transaction(
		(tx) => {
			const number = allocateTicketNumber(tx, project.id);
			const created = tx
				.insert(schema.tickets)
				.values({
					projectId: project.id,
					number,
					type: input.type,
					title: input.title,
					descriptionHtml: input.descriptionHtml,
					descriptionText: input.descriptionText,
					context: input.context,
					reporterId: actor.id,
					status: workflow.defaultStatus,
					priority: workflow.defaultPriority,
					source: extras.source ?? 'web',
					environment: extras.environment ?? null
				})
				.returning()
				.get();
			attachPending(tx, actor.id, attachmentIds, { projectId: project.id, ticketId: created.id });
			if (extras.template) saveTemplateResponse(tx, created.id, extras.template);
			tx.insert(schema.ticketFollowers)
				.values({ ticketId: created.id, userId: actor.id })
				.onConflictDoNothing()
				.run();
			addActivity(tx, created.id, actor.id, 'created', {
				type: input.type,
				source: extras.source ?? 'web'
			});
			notify(
				projectStaffIds(project.id),
				{
					type: 'new_ticket',
					project,
					ticketId: created.id,
					actorId: actor.id,
					data: { title: created.title, ticketType: created.type }
				},
				tx
			);
			emitProjectEvent(tx, project, 'ticket.created', () => ({
				ticket: ticketSnapshot(tx, created.id)
			}));
			fireTrigger(tx, project.id, 'ticket.created', created.id, { source: created.source });
			return created;
		},
		{ behavior: 'immediate' }
	);
	return ticket;
}

export function updateTicketContent(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	input: TicketInput,
	newAttachmentIds: string[] = []
) {
	if (!canEditTicket(access, actor, ticket))
		throw new ServiceError('You cannot edit this ticket', 'form', 403);
	const changed: string[] = [];
	if (input.title !== ticket.title) changed.push('title');
	if (input.descriptionHtml !== ticket.descriptionHtml) changed.push('description');
	if (JSON.stringify(input.context) !== JSON.stringify(ticket.context)) changed.push('details');
	if (input.type !== ticket.type) changed.push('type');
	if (newAttachmentIds.length && !access.canAttach)
		throw new ServiceError('Attachments are disabled for this project', 'attachments');

	getDb().transaction(
		(tx) => {
			if (newAttachmentIds.length) {
				const max = getSettings().maxAttachmentsPerTicket;
				if (ticketAttachmentCount(ticket.id, tx) + newAttachmentIds.length > max)
					throw new ServiceError(`You can attach up to ${max} images per ticket`, 'attachments');
				const added = attachPending(tx, actor.id, newAttachmentIds, {
					projectId: ticket.projectId,
					ticketId: ticket.id
				});
				if (added) changed.push('attachments');
			}
			if (!changed.length) return;
			tx.update(schema.tickets)
				.set({
					type: input.type,
					title: input.title,
					descriptionHtml: input.descriptionHtml,
					descriptionText: input.descriptionText,
					context: input.context,
					updatedAt: new Date()
				})
				.where(eq(schema.tickets.id, ticket.id))
				.run();
			addActivity(tx, ticket.id, actor.id, 'edited', {
				fields: changed,
				previousTitle: changed.includes('title') ? ticket.title : undefined
			});
			notify(
				followerIds(ticket.id, tx),
				{
					type: 'update',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data: { kind: 'edited', fields: changed }
				},
				tx
			);
			emitProjectEvent(tx, access.project, 'ticket.updated', () => ({
				ticket: ticketSnapshot(tx, ticket.id),
				changes: changed
			}));
			fireTrigger(tx, access.project.id, 'ticket.updated', ticket.id, { fields: changed });
		},
		{ behavior: 'immediate' }
	);
	return changed;
}

export function removeTicketAttachment(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	attachmentId: string
) {
	if (!canEditTicket(access, actor, ticket))
		throw new ServiceError('You cannot edit this ticket', 'form', 403);
	const att = getDb()
		.select()
		.from(schema.attachments)
		.where(
			and(
				eq(schema.attachments.id, attachmentId),
				eq(schema.attachments.ticketId, ticket.id),
				isNull(schema.attachments.commentId)
			)
		)
		.get();
	if (!att || att.deletedAt) throw new ServiceError('Attachment not found', 'form', 404);
	getDb().transaction((tx) => {
		tx.update(schema.attachments)
			.set({ deletedAt: new Date() })
			.where(eq(schema.attachments.id, att.id))
			.run();
		tx.update(schema.tickets)
			.set({ updatedAt: new Date() })
			.where(eq(schema.tickets.id, ticket.id))
			.run();
		addActivity(tx, ticket.id, actor.id, 'attachment_removed', { name: att.originalName });
	});
	removeFiles(att);
}

/** Whether `actor` may reopen `ticket` as its reporter (project workflow setting). */
export function canReporterReopen(
	actor: Pick<ActiveActor, 'id'> | null,
	access: ProjectAccess,
	ticket: Pick<Ticket, 'reporterId' | 'status'>
) {
	if (!actor || access.archived || !access.canView || ticket.reporterId !== actor.id) return false;
	if (ticket.status !== 'completed') return false;
	const workflow = workflowFor(access.project);
	return (
		workflow.reporterCanReopen &&
		!checkTransition(workflow, ticket.status, workflow.defaultStatus, 'reopen')
	);
}

export function changeStatus(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	input: { status: TicketStatus; note: string | null; duplicateOf?: string }
) {
	// Besides staff, a reporter may reopen their own completed ticket if the workflow allows it.
	const reporterReopen =
		!access.isStaff &&
		canReporterReopen(actor, access, ticket) &&
		input.status === workflowFor(access.project).defaultStatus;
	if ((!access.isStaff && !reporterReopen) || access.archived)
		throw new ServiceError('Only project staff can change the status', 'status', 403);
	let target: Ticket | undefined;
	if (input.status === 'duplicate') {
		const number = input.duplicateOf
			? parseTicketReference(input.duplicateOf, access.project.key)
			: null;
		target = number ? getTicket(ticket.projectId, number) : undefined;
		if (input.duplicateOf && !target)
			throw new ServiceError(`No ticket ${input.duplicateOf} in this project`, 'duplicateOf');
	}
	const problem = validateStatusChange(ticket, input.status, target ?? null);
	if (problem)
		throw new ServiceError(problem, input.status === 'duplicate' ? 'duplicateOf' : 'status');
	const workflowProblem = checkTransition(
		workflowFor(access.project),
		ticket.status,
		input.status,
		input.note
	);
	if (workflowProblem)
		throw new ServiceError(
			workflowProblem,
			workflowProblem.startsWith('A note') ? 'note' : 'status'
		);

	const from = ticket.status;
	const to = input.status;
	const effect = statusEffect(from, to);
	const now = new Date();
	getDb().transaction(
		(tx) => {
			// Re-read inside the transaction so concurrent changes are not silently overwritten.
			const current = tx
				.select({ status: schema.tickets.status })
				.from(schema.tickets)
				.where(eq(schema.tickets.id, ticket.id))
				.get();
			if (current?.status !== from)
				throw new ServiceError(
					'The ticket was changed by someone else. Reload and try again.',
					'status',
					409
				);
			tx.update(schema.tickets)
				.set({
					status: to,
					duplicateOfId: to === 'duplicate' ? target!.id : null,
					resolutionNote: input.note,
					completedAt:
						to === 'completed' ? now : STATUS_META[to].resolved ? ticket.completedAt : null,
					closedAt: STATUS_META[to].resolved ? now : null,
					updatedAt: now
				})
				.where(eq(schema.tickets.id, ticket.id))
				.run();
			addActivity(tx, ticket.id, actor.id, 'status', {
				from,
				to,
				effect,
				note: input.note ?? undefined,
				duplicateOf: target
					? { id: target.id, number: target.number, title: target.title }
					: undefined
			});
			if (target) {
				// People following the duplicate probably care about the original too.
				const followers = followerIds(ticket.id, tx);
				if (followers.length)
					tx.insert(schema.ticketFollowers)
						.values(followers.map((userId) => ({ ticketId: target!.id, userId })))
						.onConflictDoNothing()
						.run();
				const merged = mergeIntoCanonical(tx, ticket.id, target.id);
				addActivity(tx, target.id, actor.id, 'duplicate_linked', {
					number: ticket.number,
					title: ticket.title,
					votesAdded: merged.votesAdded || undefined,
					duplicatesMoved: merged.duplicatesMoved || undefined
				});
			}
			notify(
				[...followerIds(ticket.id, tx), ticket.reporterId],
				{
					type: 'status',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data: { from, to, note: input.note ?? undefined, duplicateOf: target?.number }
				},
				tx
			);
			emitStatusEvents(tx, access.project, ticket.id, from, to);
			fireStatusTriggers(tx, access.project.id, ticket.id, from, to);
		},
		{ behavior: 'immediate' }
	);
}

/**
 * Status change made by an automation (GitHub merge rules), not by a person. Only moves
 * unresolved tickets forward; records who/what did it in the activity history, notifies
 * followers and emits the usual integration events. Returns true if the ticket changed.
 */
export function setStatusBySystem(
	project: ProjectAccess['project'],
	ticketId: number,
	to: 'in_progress' | 'completed',
	automation: Record<string, unknown>
): boolean {
	return getDb().transaction(
		(tx) => {
			const current = tx.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get();
			if (!current || current.projectId !== project.id) return false;
			const from = current.status;
			if (STATUS_META[from].resolved || from === to) return false;
			if (to === 'in_progress' && from === 'in_progress') return false;
			const note = automation.pr ? `Pull request #${automation.pr} was merged.` : null;
			if (checkTransition(workflowFor(project), from, to, note)) return false;
			const now = new Date();
			tx.update(schema.tickets)
				.set({
					status: to,
					completedAt: to === 'completed' ? now : null,
					closedAt: to === 'completed' ? now : null,
					updatedAt: now
				})
				.where(eq(schema.tickets.id, ticketId))
				.run();
			addActivity(tx, ticketId, null, 'status', {
				from,
				to,
				effect: statusEffect(from, to),
				automation
			});
			notify(
				[...followerIds(ticketId, tx), current.reporterId],
				{
					type: 'status',
					project,
					ticketId,
					actorId: null,
					data: { from, to, automation: automation.source }
				},
				tx
			);
			emitStatusEvents(tx, project, ticketId, from, to, { automation });
			fireStatusTriggers(tx, project.id, ticketId, from, to);
			return true;
		},
		{ behavior: 'immediate' }
	);
}

/** Status change events for integrations (plus ticket.completed when it was completed). */
export function emitStatusEvents(
	tx: DB,
	project: ProjectAccess['project'],
	ticketId: number,
	from: TicketStatus,
	to: TicketStatus,
	extra: Record<string, unknown> = {}
) {
	if (from === to) return;
	const snapshot = () => ticketSnapshot(tx, ticketId);
	emitProjectEvent(tx, project, 'ticket.status_changed', () => ({
		ticket: snapshot(),
		from,
		to,
		...extra
	}));
	if (to === 'completed')
		emitProjectEvent(tx, project, 'ticket.completed', () => ({ ticket: snapshot(), ...extra }));
}

/**
 * Folds a duplicate into its canonical ticket: every voter of the duplicate counts as a voter
 * of the canonical ticket (once – people who voted on both are not counted twice), and tickets
 * that were duplicates of the duplicate now point at the canonical ticket, so duplicate chains
 * never form. The duplicate keeps its own votes, comments and history untouched.
 */
export function mergeIntoCanonical(tx: DB, duplicateId: number, canonicalId: number) {
	const voters = tx
		.select({ userId: schema.ticketVotes.userId })
		.from(schema.ticketVotes)
		.where(eq(schema.ticketVotes.ticketId, duplicateId))
		.all();
	let votesAdded = 0;
	if (voters.length) {
		votesAdded = tx
			.insert(schema.ticketVotes)
			.values(voters.map((v) => ({ ticketId: canonicalId, userId: v.userId })))
			.onConflictDoNothing()
			.run().changes;
		tx.update(schema.tickets)
			.set({
				voteCount: sql`(select count(*) from ${schema.ticketVotes} where ${schema.ticketVotes.ticketId} = ${canonicalId})`
			})
			.where(eq(schema.tickets.id, canonicalId))
			.run();
	}
	const duplicatesMoved = tx
		.update(schema.tickets)
		.set({ duplicateOfId: canonicalId })
		.where(eq(schema.tickets.duplicateOfId, duplicateId))
		.run().changes;
	return { votesAdded, duplicatesMoved };
}

export function changePriority(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	priority: TicketPriority
) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can change the priority', 'priority', 403);
	if (priority === ticket.priority) return;
	getDb().transaction((tx) => {
		tx.update(schema.tickets)
			.set({ priority, updatedAt: new Date() })
			.where(eq(schema.tickets.id, ticket.id))
			.run();
		addActivity(tx, ticket.id, actor.id, 'priority', { from: ticket.priority, to: priority });
		notify(
			followerIds(ticket.id, tx),
			{
				type: 'update',
				project: access.project,
				ticketId: ticket.id,
				actorId: actor.id,
				data: { kind: 'priority', from: ticket.priority, to: priority }
			},
			tx
		);
		emitProjectEvent(tx, access.project, 'ticket.updated', () => ({
			ticket: ticketSnapshot(tx, ticket.id),
			changes: ['priority'],
			priority: { from: ticket.priority, to: priority }
		}));
		fireTrigger(tx, access.project.id, 'ticket.priority_changed', ticket.id, {
			from: ticket.priority,
			to: priority
		});
	});
}

export function assignTicket(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	assigneeId: number | null
) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can assign tickets', 'assignee', 403);
	if (assigneeId === ticket.assigneeId) return;
	if (assigneeId !== null && !isAssignable(ticket.projectId, assigneeId))
		throw new ServiceError('Tickets can only be assigned to project staff', 'assignee');
	getDb().transaction((tx) => {
		tx.update(schema.tickets)
			.set({ assigneeId, updatedAt: new Date() })
			.where(eq(schema.tickets.id, ticket.id))
			.run();
		const assignee = assigneeId
			? tx
					.select({ displayName: schema.users.displayName })
					.from(schema.users)
					.where(eq(schema.users.id, assigneeId))
					.get()
			: null;
		addActivity(tx, ticket.id, actor.id, assigneeId ? 'assigned' : 'unassigned', {
			assigneeId,
			assigneeName: assignee?.displayName
		});
		emitProjectEvent(tx, access.project, 'ticket.assigned', () => ({
			ticket: ticketSnapshot(tx, ticket.id)
		}));
		fireTrigger(tx, access.project.id, 'ticket.assignee_changed', ticket.id, {
			from: ticket.assigneeId,
			to: assigneeId
		});
		if (assigneeId) {
			tx.insert(schema.ticketFollowers)
				.values({ ticketId: ticket.id, userId: assigneeId })
				.onConflictDoNothing()
				.run();
			notify(
				[assigneeId],
				{
					type: 'assigned',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data: {}
				},
				tx
			);
		}
	});
}

export function setTicketLabels(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	labelIds: number[]
) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can change labels', 'labels', 403);
	const db = getDb();
	const valid = labelIds.length
		? db
				.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
				.from(schema.ticketLabels)
				.where(
					and(
						eq(schema.ticketLabels.projectId, ticket.projectId),
						inArray(schema.ticketLabels.id, labelIds)
					)
				)
				.all()
		: [];
	const current = db
		.select({ id: schema.ticketLabelAssignments.labelId })
		.from(schema.ticketLabelAssignments)
		.where(eq(schema.ticketLabelAssignments.ticketId, ticket.id))
		.all()
		.map((r) => r.id);
	const next = valid.map((l) => l.id);
	const added = next.filter((id) => !current.includes(id));
	const removed = current.filter((id) => !next.includes(id));
	if (!added.length && !removed.length) return;
	db.transaction((tx) => {
		tx.delete(schema.ticketLabelAssignments)
			.where(eq(schema.ticketLabelAssignments.ticketId, ticket.id))
			.run();
		if (next.length)
			tx.insert(schema.ticketLabelAssignments)
				.values(next.map((labelId) => ({ ticketId: ticket.id, labelId })))
				.run();
		tx.update(schema.tickets)
			.set({ updatedAt: new Date() })
			.where(eq(schema.tickets.id, ticket.id))
			.run();
		addActivity(tx, ticket.id, actor.id, 'labels', {
			added: valid.filter((l) => added.includes(l.id)).map((l) => l.name),
			removedCount: removed.length
		});
		for (const labelId of added)
			fireTrigger(tx, ticket.projectId, 'ticket.label_added', ticket.id, { labelId });
		for (const labelId of removed)
			fireTrigger(tx, ticket.projectId, 'ticket.label_removed', ticket.id, { labelId });
	});
}

/**
 * Adds or removes the actor's vote. The vote row's primary key guarantees one vote per user and
 * the counter is adjusted in the same transaction only when a row actually changed.
 */
export function setVote(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	on: boolean
): number {
	if (!access.canVote)
		throw new ServiceError('Voting is not available for this ticket', 'form', 403);
	return getDb().transaction(
		(tx) => {
			if (on) {
				const res = tx
					.insert(schema.ticketVotes)
					.values({ ticketId: ticket.id, userId: actor.id })
					.onConflictDoNothing()
					.run();
				if (res.changes)
					tx.update(schema.tickets)
						.set({ voteCount: sql`${schema.tickets.voteCount} + 1` })
						.where(eq(schema.tickets.id, ticket.id))
						.run();
			} else {
				const res = tx
					.delete(schema.ticketVotes)
					.where(
						and(eq(schema.ticketVotes.ticketId, ticket.id), eq(schema.ticketVotes.userId, actor.id))
					)
					.run();
				if (res.changes)
					tx.update(schema.tickets)
						.set({ voteCount: sql`max(${schema.tickets.voteCount} - 1, 0)` })
						.where(eq(schema.tickets.id, ticket.id))
						.run();
			}
			const votes =
				tx
					.select({ n: schema.tickets.voteCount })
					.from(schema.tickets)
					.where(eq(schema.tickets.id, ticket.id))
					.get()?.n ?? 0;
			if (on) fireVoteThreshold(tx, ticket.projectId, ticket.id, votes - 1, votes);
			return votes;
		},
		{ behavior: 'immediate' }
	);
}

export function setFollow(actor: ActiveActor, ticket: Ticket, on: boolean) {
	const db = getDb();
	if (on)
		db.insert(schema.ticketFollowers)
			.values({ ticketId: ticket.id, userId: actor.id })
			.onConflictDoNothing()
			.run();
	else
		db.delete(schema.ticketFollowers)
			.where(
				and(
					eq(schema.ticketFollowers.ticketId, ticket.id),
					eq(schema.ticketFollowers.userId, actor.id)
				)
			)
			.run();
}

// ── Detail view ──────────────────────────────────────────────────────────

/**
 * Everything the ticket page shows. `opts.internal` decides whether internal staff notes
 * (and their attachments and activity) are included – callers pass
 * `canViewInternalNotes(access)`; nothing internal leaves this function otherwise.
 */
export function getTicketDetail(actor: Actor, ticket: Ticket, opts: { internal: boolean }) {
	const db = getDb();
	const reporter = alias(schema.users, 'reporter');
	const assignee = alias(schema.users, 'assignee');
	const people = db
		.select({
			reporter: {
				id: reporter.id,
				username: reporter.username,
				displayName: reporter.displayName,
				avatarId: reporter.avatarId
			},
			assignee: {
				id: assignee.id,
				username: assignee.username,
				displayName: assignee.displayName,
				avatarId: assignee.avatarId
			}
		})
		.from(schema.tickets)
		.innerJoin(reporter, eq(reporter.id, schema.tickets.reporterId))
		.leftJoin(assignee, eq(assignee.id, schema.tickets.assigneeId))
		.where(eq(schema.tickets.id, ticket.id))
		.get()!;

	const labels = db
		.select({
			id: schema.ticketLabels.id,
			name: schema.ticketLabels.name,
			color: schema.ticketLabels.color
		})
		.from(schema.ticketLabelAssignments)
		.innerJoin(
			schema.ticketLabels,
			eq(schema.ticketLabels.id, schema.ticketLabelAssignments.labelId)
		)
		.where(eq(schema.ticketLabelAssignments.ticketId, ticket.id))
		.orderBy(asc(schema.ticketLabels.name))
		.all();

	const attachmentRows = db
		.select({
			id: schema.attachments.id,
			commentId: schema.attachments.commentId,
			originalName: schema.attachments.originalName,
			mimeType: schema.attachments.mimeType,
			size: schema.attachments.size,
			width: schema.attachments.width,
			height: schema.attachments.height,
			hasThumbnail: schema.attachments.hasThumbnail,
			createdAt: schema.attachments.createdAt
		})
		.from(schema.attachments)
		.where(and(eq(schema.attachments.ticketId, ticket.id), isNull(schema.attachments.deletedAt)))
		.orderBy(asc(schema.attachments.createdAt))
		.all();

	const author = alias(schema.users, 'author');
	const comments = db
		.select({
			id: schema.ticketComments.id,
			bodyHtml: schema.ticketComments.bodyHtml,
			internal: schema.ticketComments.internal,
			meta: schema.ticketComments.meta,
			createdAt: schema.ticketComments.createdAt,
			editedAt: schema.ticketComments.editedAt,
			deletedAt: schema.ticketComments.deletedAt,
			authorId: schema.ticketComments.authorId,
			author: {
				id: author.id,
				username: author.username,
				displayName: author.displayName,
				avatarId: author.avatarId
			},
			authorRole: schema.projectMembers.role,
			authorGlobalRole: author.role
		})
		.from(schema.ticketComments)
		.innerJoin(author, eq(author.id, schema.ticketComments.authorId))
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.userId, author.id),
				eq(schema.projectMembers.projectId, ticket.projectId)
			)
		)
		.where(
			and(
				eq(schema.ticketComments.ticketId, ticket.id),
				opts.internal ? undefined : eq(schema.ticketComments.internal, false)
			)
		)
		.orderBy(asc(schema.ticketComments.createdAt))
		.all()
		.map((c) => ({
			...c,
			bodyHtml: c.deletedAt ? '' : c.bodyHtml,
			attachments: c.deletedAt ? [] : attachmentRows.filter((a) => a.commentId === c.id)
		}));

	const activityActor = alias(schema.users, 'activity_actor');
	const activity = db
		.select({
			id: schema.ticketActivity.id,
			type: schema.ticketActivity.type,
			data: schema.ticketActivity.data,
			createdAt: schema.ticketActivity.createdAt,
			actor: {
				id: activityActor.id,
				displayName: activityActor.displayName,
				avatarId: activityActor.avatarId
			}
		})
		.from(schema.ticketActivity)
		.leftJoin(activityActor, eq(activityActor.id, schema.ticketActivity.actorId))
		.where(eq(schema.ticketActivity.ticketId, ticket.id))
		.orderBy(asc(schema.ticketActivity.createdAt))
		.all()
		.filter((a) => opts.internal || !(a.data as { internal?: boolean } | null)?.internal);

	const duplicateOf = ticket.duplicateOfId
		? db
				.select({
					number: schema.tickets.number,
					title: schema.tickets.title,
					status: schema.tickets.status
				})
				.from(schema.tickets)
				.where(eq(schema.tickets.id, ticket.duplicateOfId))
				.get()
		: undefined;
	const duplicates = db
		.select({
			number: schema.tickets.number,
			title: schema.tickets.title,
			status: schema.tickets.status
		})
		.from(schema.tickets)
		.where(eq(schema.tickets.duplicateOfId, ticket.id))
		.orderBy(asc(schema.tickets.number))
		.all();

	const releases = shippedIn(ticket);

	let hasVoted = false;
	let isFollowing = false;
	if (actor) {
		hasVoted = !!db
			.select({ t: schema.ticketVotes.ticketId })
			.from(schema.ticketVotes)
			.where(
				and(eq(schema.ticketVotes.ticketId, ticket.id), eq(schema.ticketVotes.userId, actor.id))
			)
			.get();
		isFollowing = !!db
			.select({ t: schema.ticketFollowers.ticketId })
			.from(schema.ticketFollowers)
			.where(
				and(
					eq(schema.ticketFollowers.ticketId, ticket.id),
					eq(schema.ticketFollowers.userId, actor.id)
				)
			)
			.get();
	}
	const followerCount =
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.ticketFollowers)
			.where(eq(schema.ticketFollowers.ticketId, ticket.id))
			.get()?.n ?? 0;

	return {
		reporter: people.reporter,
		assignee: people.assignee?.id ? people.assignee : null,
		labels,
		attachments: attachmentRows.filter((a) => a.commentId === null),
		comments,
		activity,
		duplicateOf: duplicateOf ?? null,
		duplicates,
		releases,
		hasVoted,
		isFollowing,
		followerCount
	};
}

export function recentVoters(ticketId: number, limit = 8) {
	return getDb()
		.select({
			id: schema.users.id,
			displayName: schema.users.displayName,
			avatarId: schema.users.avatarId
		})
		.from(schema.ticketVotes)
		.innerJoin(schema.users, eq(schema.users.id, schema.ticketVotes.userId))
		.where(eq(schema.ticketVotes.ticketId, ticketId))
		.orderBy(desc(schema.ticketVotes.createdAt))
		.limit(limit)
		.all();
}
