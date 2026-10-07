import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
	STATUS_META,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	type AutomationAction,
	type AutomationRunAction,
	type TicketPriority,
	type TicketStatus
} from '../../shared/constants';
import { statusEffect } from '../../shared/workflow';
import { schema, type DB } from '../db';
import type { Automation, Project, Ticket } from '../db/schema';
import {
	buildEnvelope,
	discordMessage,
	emitProjectEvent,
	ticketSnapshot
} from '../integrations/events';
import { enqueue } from '../outbound/queue';
import { plainTextToHtml } from '../sanitize';
import { followerIds, notify } from '../services/notifications';
import { isAssignable, projectStaffIds } from '../services/projects';
import { assignableMilestone } from '../services/milestones';
import { assignableRelease } from '../services/releases';
import { addActivity, emitStatusEvents } from '../services/tickets';
import { checkTransition, workflowFor } from '../services/workflow';
import { fireStatusTriggers, fireTrigger } from './triggers';
import { priorityLabel } from './conditions';

/**
 * Automation actions. Each action runs inside the rule's transaction (all of a rule's actions
 * succeed or none do) and only ever touches the rule's own project: every referenced user,
 * label, milestone, release and destination is re-checked against the project here, at run time.
 * Changes are recorded as made by the automation (no person is impersonated) and queue the
 * usual follow-up events, so other rules can react – within the loop limits of the engine.
 * With `dryRun`, actions only describe what they would do.
 */

export class ActionError extends Error {}

export interface ActionContext {
	tx: DB;
	project: Project;
	ticket: Ticket;
	rule: Pick<Automation, 'id' | 'name' | 'createdById'>;
	/** Account used as the author of automated comments (the rule's creator or an owner). */
	authorId: number;
	dryRun: boolean;
}

const MAX_TEXT = 4000;
const automationRef = (ctx: ActionContext) => ({ id: ctx.rule.id, name: ctx.rule.name });

function refreshTicket(ctx: ActionContext) {
	ctx.ticket = ctx.tx
		.select()
		.from(schema.tickets)
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.get()!;
}

function userName(tx: Pick<DB, 'select'>, userId: number | null) {
	if (!userId) return 'nobody';
	return (
		tx
			.select({ name: schema.users.displayName })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.get()?.name ?? `user #${userId}`
	);
}

/** The first owner of the project (by membership age), for "assign to project owner". */
export function firstOwner(tx: Pick<DB, 'select'>, projectId: number) {
	return tx
		.select({ id: schema.projectMembers.userId })
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(
			and(
				eq(schema.projectMembers.projectId, projectId),
				eq(schema.projectMembers.role, 'owner'),
				eq(schema.users.status, 'active')
			)
		)
		.orderBy(asc(schema.projectMembers.id))
		.get()?.id;
}

function label(tx: Pick<DB, 'select'>, projectId: number, labelId: number) {
	const l = tx
		.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
		.from(schema.ticketLabels)
		.where(and(eq(schema.ticketLabels.id, labelId), eq(schema.ticketLabels.projectId, projectId)))
		.get();
	if (!l) throw new ActionError('The label no longer exists in this project');
	return l;
}

function touch(ctx: ActionContext) {
	ctx.tx
		.update(schema.tickets)
		.set({ updatedAt: new Date() })
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
}

/** Dry runs apply changes to the in-memory ticket only, so later actions see them. */
function preview(ctx: ActionContext, patch: Partial<Ticket>, out: AutomationRunAction) {
	ctx.ticket = { ...ctx.ticket, ...patch };
	return out;
}

function result(a: AutomationAction, summary: string, changed: boolean): AutomationRunAction {
	return { type: a.type, summary, ok: true, changed };
}

function setStatus(ctx: ActionContext, a: AutomationAction) {
	const to = String(a.value) as TicketStatus;
	if (!TICKET_STATUSES.includes(to)) throw new ActionError('Unknown status');
	if (to === 'duplicate') throw new ActionError('Automations cannot mark tickets as duplicates');
	const from = ctx.ticket.status;
	const label = `Status: ${STATUS_META[from].label} → ${STATUS_META[to].label}`;
	if (from === to) return result(a, `Status already ${STATUS_META[to].label}`, false);
	const note = a.text?.trim() || null;
	const problem = checkTransition(workflowFor(ctx.project), from, to, note);
	if (problem) throw new ActionError(problem);
	if (ctx.dryRun) return preview(ctx, { status: to }, result(a, label, true));
	const now = new Date();
	ctx.tx
		.update(schema.tickets)
		.set({
			status: to,
			duplicateOfId: null,
			resolutionNote: note,
			completedAt:
				to === 'completed' ? now : STATUS_META[to].resolved ? ctx.ticket.completedAt : null,
			closedAt: STATUS_META[to].resolved ? now : null,
			updatedAt: now
		})
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
	const effect = statusEffect(from, to);
	addActivity(ctx.tx, ctx.ticket.id, null, 'status', {
		from,
		to,
		effect,
		note: note ?? undefined,
		automation: automationRef(ctx)
	});
	notify(
		[...followerIds(ctx.ticket.id, ctx.tx), ctx.ticket.reporterId],
		{
			type: 'status',
			project: ctx.project,
			ticketId: ctx.ticket.id,
			actorId: null,
			data: { from, to, note: note ?? undefined, automation: ctx.rule.name }
		},
		ctx.tx
	);
	emitStatusEvents(ctx.tx, ctx.project, ctx.ticket.id, from, to, {
		automation: automationRef(ctx)
	});
	fireStatusTriggers(ctx.tx, ctx.project.id, ctx.ticket.id, from, to);
	return result(a, label, true);
}

function setPriority(ctx: ActionContext, a: AutomationAction) {
	const to = String(a.value) as TicketPriority;
	if (!TICKET_PRIORITIES.includes(to)) throw new ActionError('Unknown priority');
	const from = ctx.ticket.priority;
	const label = `Priority: ${priorityLabel(from)} → ${priorityLabel(to)}`;
	if (from === to) return result(a, `Priority already ${priorityLabel(to)}`, false);
	if (ctx.dryRun) return preview(ctx, { priority: to }, result(a, label, true));
	ctx.tx
		.update(schema.tickets)
		.set({ priority: to, updatedAt: new Date() })
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
	addActivity(ctx.tx, ctx.ticket.id, null, 'priority', {
		from,
		to,
		automation: automationRef(ctx)
	});
	notify(
		followerIds(ctx.ticket.id, ctx.tx),
		{
			type: 'update',
			project: ctx.project,
			ticketId: ctx.ticket.id,
			actorId: null,
			data: { kind: 'priority', from, to, automation: ctx.rule.name }
		},
		ctx.tx
	);
	emitProjectEvent(ctx.tx, ctx.project, 'ticket.updated', () => ({
		ticket: ticketSnapshot(ctx.tx, ctx.ticket.id),
		changes: ['priority'],
		priority: { from, to },
		automation: automationRef(ctx)
	}));
	fireTrigger(ctx.tx, ctx.project.id, 'ticket.priority_changed', ctx.ticket.id, { from, to });
	return result(a, label, true);
}

function setAssignee(ctx: ActionContext, a: AutomationAction, clear: boolean) {
	let to: number | null = null;
	if (!clear) {
		if (a.value === 'owner') {
			to = firstOwner(ctx.tx, ctx.project.id) ?? null;
			if (!to) throw new ActionError('The project has no active owner');
		} else to = Number(a.value);
		if (!isAssignable(ctx.project.id, to))
			throw new ActionError('Tickets can only be assigned to project staff');
	}
	const from = ctx.ticket.assigneeId;
	const name = userName(ctx.tx, to);
	if (from === to)
		return result(a, clear ? 'Already unassigned' : `Already assigned to ${name}`, false);
	const summary = clear ? 'Assignee cleared' : `Assigned → ${name}`;
	if (ctx.dryRun) return preview(ctx, { assigneeId: to }, result(a, summary, true));
	ctx.tx
		.update(schema.tickets)
		.set({ assigneeId: to, updatedAt: new Date() })
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
	addActivity(ctx.tx, ctx.ticket.id, null, to ? 'assigned' : 'unassigned', {
		assigneeId: to,
		assigneeName: to ? name : undefined,
		automation: automationRef(ctx)
	});
	if (to) {
		ctx.tx
			.insert(schema.ticketFollowers)
			.values({ ticketId: ctx.ticket.id, userId: to })
			.onConflictDoNothing()
			.run();
		notify(
			[to],
			{
				type: 'assigned',
				project: ctx.project,
				ticketId: ctx.ticket.id,
				actorId: null,
				data: { automation: ctx.rule.name }
			},
			ctx.tx
		);
	}
	emitProjectEvent(ctx.tx, ctx.project, 'ticket.assigned', () => ({
		ticket: ticketSnapshot(ctx.tx, ctx.ticket.id),
		automation: automationRef(ctx)
	}));
	fireTrigger(ctx.tx, ctx.project.id, 'ticket.assignee_changed', ctx.ticket.id, { from, to });
	return result(a, summary, true);
}

function changeLabel(ctx: ActionContext, a: AutomationAction, add: boolean) {
	const l = label(ctx.tx, ctx.project.id, Number(a.value));
	const has = !!ctx.tx
		.select({ id: schema.ticketLabelAssignments.labelId })
		.from(schema.ticketLabelAssignments)
		.where(
			and(
				eq(schema.ticketLabelAssignments.ticketId, ctx.ticket.id),
				eq(schema.ticketLabelAssignments.labelId, l.id)
			)
		)
		.get();
	if (add === has)
		return result(a, add ? `Label “${l.name}” already set` : `Label “${l.name}” not set`, false);
	const summary = add ? `Label added → ${l.name}` : `Label removed → ${l.name}`;
	if (ctx.dryRun) return result(a, summary, true);
	if (add)
		ctx.tx
			.insert(schema.ticketLabelAssignments)
			.values({ ticketId: ctx.ticket.id, labelId: l.id })
			.run();
	else
		ctx.tx
			.delete(schema.ticketLabelAssignments)
			.where(
				and(
					eq(schema.ticketLabelAssignments.ticketId, ctx.ticket.id),
					eq(schema.ticketLabelAssignments.labelId, l.id)
				)
			)
			.run();
	touch(ctx);
	addActivity(ctx.tx, ctx.ticket.id, null, 'labels', {
		added: add ? [l.name] : [],
		removed: add ? [] : [l.name],
		removedCount: add ? 0 : 1,
		automation: automationRef(ctx)
	});
	fireTrigger(
		ctx.tx,
		ctx.project.id,
		add ? 'ticket.label_added' : 'ticket.label_removed',
		ctx.ticket.id,
		{
			labelId: l.id
		}
	);
	return result(a, summary, true);
}

function setPlanning(
	ctx: ActionContext,
	a: AutomationAction,
	kind: 'milestone' | 'release',
	clear: boolean
) {
	const column = kind === 'milestone' ? 'milestoneId' : 'releaseId';
	const current = ctx.ticket[column];
	let to: { id: number; name: string } | null = null;
	if (!clear) {
		try {
			if (kind === 'milestone') {
				const m = assignableMilestone(ctx.tx, ctx.project.id, Number(a.value));
				to = { id: m.id, name: m.name };
			} else {
				const r = assignableRelease(ctx.tx, ctx.project.id, Number(a.value));
				to = { id: r.id, name: r.version };
			}
		} catch (err) {
			throw new ActionError(err instanceof Error ? err.message : `Unknown ${kind}`);
		}
	}
	const noun = kind === 'milestone' ? 'Milestone' : 'Release';
	if ((to?.id ?? null) === current)
		return result(a, clear ? `No ${kind} to remove` : `${noun} already ${to!.name}`, false);
	const summary = clear ? `${noun} removed` : `${noun} → ${to!.name}`;
	if (ctx.dryRun) return preview(ctx, { [column]: to?.id ?? null }, result(a, summary, true));
	const previous = current
		? kind === 'milestone'
			? ctx.tx
					.select({ name: schema.milestones.name })
					.from(schema.milestones)
					.where(eq(schema.milestones.id, current))
					.get()?.name
			: ctx.tx
					.select({ name: schema.changelogEntries.version })
					.from(schema.changelogEntries)
					.where(eq(schema.changelogEntries.id, current))
					.get()?.name
		: null;
	ctx.tx
		.update(schema.tickets)
		.set({ [column]: to?.id ?? null, updatedAt: new Date() })
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
	addActivity(ctx.tx, ctx.ticket.id, null, kind, {
		from: previous ?? null,
		to: to?.name ?? null,
		automation: automationRef(ctx)
	});
	if (to)
		fireTrigger(
			ctx.tx,
			ctx.project.id,
			kind === 'milestone' ? 'ticket.milestone_assigned' : 'ticket.release_assigned',
			ctx.ticket.id,
			{ [`${kind}Id`]: to.id }
		);
	return result(a, summary, true);
}

/** Members who can see the project (followers must be able to read what they follow). */
function viewers(tx: Pick<DB, 'select'>, project: Project, ids: number[]) {
	if (!ids.length) return [];
	const rows = tx
		.select({
			id: schema.users.id,
			role: schema.users.role,
			memberRole: schema.projectMembers.role
		})
		.from(schema.users)
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.userId, schema.users.id),
				eq(schema.projectMembers.projectId, project.id)
			)
		)
		.where(and(inArray(schema.users.id, ids), eq(schema.users.status, 'active')))
		.all();
	return rows
		.filter((u) => project.visibility === 'public' || u.role === 'admin' || u.memberRole)
		.map((u) => u.id);
}

function targets(ctx: ActionContext, target: string): number[] {
	const t = ctx.ticket;
	switch (target) {
		case 'assignee':
			return t.assigneeId ? [t.assigneeId] : [];
		case 'reporter':
			return [t.reporterId];
		case 'owners':
			return ctx.tx
				.select({ id: schema.projectMembers.userId })
				.from(schema.projectMembers)
				.where(
					and(
						eq(schema.projectMembers.projectId, ctx.project.id),
						eq(schema.projectMembers.role, 'owner')
					)
				)
				.all()
				.map((r) => r.id);
		case 'staff':
			return projectStaffIds(ctx.project.id);
		case 'followers':
			return followerIds(t.id, ctx.tx);
		default: {
			const id = Number(target);
			return Number.isInteger(id) && id > 0 ? viewers(ctx.tx, ctx.project, [id]) : [];
		}
	}
}

const TARGET_LABEL: Record<string, string> = {
	assignee: 'the assignee',
	reporter: 'the reporter',
	owners: 'project owners',
	staff: 'project staff',
	followers: 'followers'
};

function follow(ctx: ActionContext, a: AutomationAction) {
	const target = String(a.value ?? '');
	const ids = viewers(ctx.tx, ctx.project, targets(ctx, target));
	const existing = new Set(followerIds(ctx.ticket.id, ctx.tx));
	const fresh = ids.filter((id) => !existing.has(id));
	const who = TARGET_LABEL[target] ?? userName(ctx.tx, Number(target));
	if (!fresh.length)
		return result(a, `${who} already follow${fresh.length === 1 ? 's' : ''}`, false);
	const summary = `Followers added → ${who}`;
	if (ctx.dryRun) return result(a, summary, true);
	ctx.tx
		.insert(schema.ticketFollowers)
		.values(fresh.map((userId) => ({ ticketId: ctx.ticket.id, userId })))
		.onConflictDoNothing()
		.run();
	return result(a, summary, true);
}

function addComment(ctx: ActionContext, a: AutomationAction, internal: boolean) {
	const body = (a.text ?? '').trim().slice(0, MAX_TEXT);
	if (!body) throw new ActionError('The comment text is empty');
	const summary = internal ? 'Internal note added' : 'Public comment added';
	if (ctx.dryRun) return result(a, summary, true);
	const comment = ctx.tx
		.insert(schema.ticketComments)
		.values({
			ticketId: ctx.ticket.id,
			authorId: ctx.authorId,
			// Plain text from the rule, escaped – never HTML.
			bodyHtml: plainTextToHtml(body),
			bodyText: body,
			internal,
			meta: { automation: automationRef(ctx) }
		})
		.returning()
		.get();
	if (internal) return result(a, summary, true);
	ctx.tx
		.update(schema.tickets)
		.set({ commentCount: sql`${schema.tickets.commentCount} + 1`, updatedAt: new Date() })
		.where(eq(schema.tickets.id, ctx.ticket.id))
		.run();
	notify(
		[...followerIds(ctx.ticket.id, ctx.tx), ctx.ticket.reporterId],
		{
			type: 'comment',
			project: ctx.project,
			ticketId: ctx.ticket.id,
			actorId: null,
			data: { commentId: comment.id, excerpt: body.slice(0, 160), automation: ctx.rule.name }
		},
		ctx.tx
	);
	emitProjectEvent(ctx.tx, ctx.project, 'comment.created', () => {
		const snapshot = ticketSnapshot(ctx.tx, ctx.ticket.id);
		return {
			ticket: snapshot,
			comment: {
				id: comment.id,
				author: { username: null, name: `Automation: ${ctx.rule.name}` },
				automated: true,
				body,
				created_at: comment.createdAt.toISOString(),
				url: snapshot?.url ? `${snapshot.url}#comment-${comment.id}` : null
			}
		};
	});
	fireTrigger(ctx.tx, ctx.project.id, 'comment.created', ctx.ticket.id, { commentId: comment.id });
	return result(a, summary, true);
}

function sendNotification(ctx: ActionContext, a: AutomationAction) {
	const target = String(a.value ?? 'staff');
	const message = (a.text ?? '').trim().slice(0, 300);
	const recipients = targets(ctx, target);
	const who = TARGET_LABEL[target] ?? userName(ctx.tx, Number(target));
	if (!recipients.length) return result(a, `Nobody to notify (${who})`, false);
	const summary = `Notification → ${who}`;
	if (ctx.dryRun) return result(a, summary, true);
	notify(
		recipients,
		{
			type: 'update',
			project: ctx.project,
			ticketId: ctx.ticket.id,
			actorId: null,
			data: { kind: 'automation', automation: ctx.rule.name, message: message || undefined }
		},
		ctx.tx
	);
	return result(a, summary, true);
}

function triggerHook(ctx: ActionContext, a: AutomationAction) {
	const hook = ctx.tx
		.select()
		.from(schema.projectHooks)
		.where(
			and(
				eq(schema.projectHooks.id, Number(a.value)),
				eq(schema.projectHooks.projectId, ctx.project.id)
			)
		)
		.get();
	if (!hook) throw new ActionError('The destination no longer exists in this project');
	if (!hook.enabled) return result(a, `Destination “${hook.name}” is disabled`, false);
	const summary = `Sent to ${hook.kind === 'discord' ? 'Discord' : 'webhook'} → ${hook.name}`;
	if (ctx.dryRun) return result(a, summary, true);
	const data = {
		automation: automationRef(ctx),
		message: a.text?.trim().slice(0, 300) || undefined,
		ticket: ticketSnapshot(ctx.tx, ctx.ticket.id)
	};
	const envelope = buildEnvelope(ctx.project, 'automation.triggered', data);
	enqueue(
		{
			kind: hook.kind,
			payload:
				hook.kind === 'webhook'
					? { envelope, summary: `automation.triggered ${envelope.id}` }
					: {
							event: 'automation.triggered',
							eventId: envelope.id,
							message: discordMessage(ctx.project, 'automation.triggered', data),
							summary: `automation.triggered ${envelope.id}`
						},
			dedupeKey: `hook:${hook.id}:${envelope.id}`,
			projectId: ctx.project.id,
			hookId: hook.id
		},
		ctx.tx
	);
	return result(a, summary, true);
}

/** Runs (or, in dry-run mode, describes) one action. Throws ActionError on failure. */
export function runAction(ctx: ActionContext, a: AutomationAction): AutomationRunAction {
	const out = (() => {
		switch (a.type) {
			case 'set_status':
				return setStatus(ctx, a);
			case 'set_priority':
				return setPriority(ctx, a);
			case 'assign':
				return setAssignee(ctx, a, false);
			case 'clear_assignee':
				return setAssignee(ctx, a, true);
			case 'add_label':
				return changeLabel(ctx, a, true);
			case 'remove_label':
				return changeLabel(ctx, a, false);
			case 'set_milestone':
				return setPlanning(ctx, a, 'milestone', false);
			case 'clear_milestone':
				return setPlanning(ctx, a, 'milestone', true);
			case 'set_release':
				return setPlanning(ctx, a, 'release', false);
			case 'clear_release':
				return setPlanning(ctx, a, 'release', true);
			case 'follow':
				return follow(ctx, a);
			case 'internal_note':
				return addComment(ctx, a, true);
			case 'public_comment':
				return addComment(ctx, a, false);
			case 'notify':
				return sendNotification(ctx, a);
			case 'trigger_hook':
				return triggerHook(ctx, a);
			default:
				throw new ActionError('Unknown action');
		}
	})();
	// Later actions (and rules) see the updated ticket.
	if (!ctx.dryRun && out.changed) refreshTicket(ctx);
	return out;
}
