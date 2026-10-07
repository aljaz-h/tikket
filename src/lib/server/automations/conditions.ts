import { and, eq, isNull, sql } from 'drizzle-orm';
import {
	PRIORITY_META,
	TICKET_PRIORITIES,
	type AutomationCondition,
	type AutomationConditions,
	type TicketPriority
} from '../../shared/constants';
import { getDb, schema, type DB } from '../db';
import type { Ticket } from '../db/schema';

/** Everything a condition can look at, loaded once per rule evaluation. */
export interface TicketFacts {
	ticket: Ticket;
	labelIds: number[];
	attachmentCount: number;
	/** owner | moderator | member | admin | none (a non-member of a public project). */
	reporterRole: string;
}

export function loadFacts(ticketId: number, tx: Pick<DB, 'select'> = getDb()): TicketFacts | null {
	const ticket = tx.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId)).get();
	if (!ticket) return null;
	const labelIds = tx
		.select({ id: schema.ticketLabelAssignments.labelId })
		.from(schema.ticketLabelAssignments)
		.where(eq(schema.ticketLabelAssignments.ticketId, ticketId))
		.all()
		.map((r) => r.id);
	const attachmentCount =
		tx
			.select({ n: sql<number>`count(*)` })
			.from(schema.attachments)
			.where(and(eq(schema.attachments.ticketId, ticketId), isNull(schema.attachments.deletedAt)))
			.get()?.n ?? 0;
	const reporter = tx
		.select({ role: schema.users.role, memberRole: schema.projectMembers.role })
		.from(schema.users)
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.userId, schema.users.id),
				eq(schema.projectMembers.projectId, ticket.projectId)
			)
		)
		.where(eq(schema.users.id, ticket.reporterId))
		.get();
	const reporterRole = reporter?.memberRole ?? (reporter?.role === 'admin' ? 'admin' : 'none');
	return { ticket, labelIds, attachmentCount, reporterRole };
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const text = (v: unknown) => String(v ?? '').toLowerCase();
const id = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const rank = (p: string) => TICKET_PRIORITIES.indexOf(p as TicketPriority);

/** Evaluates one condition. Unknown fields/operators never match (fail closed). */
export function evaluateCondition(c: AutomationCondition, f: TicketFacts, now = Date.now()) {
	const t = f.ticket;
	const eqOrNot = (actual: unknown, expected: unknown) =>
		c.op === 'is' ? actual === expected : c.op === 'is_not' ? actual !== expected : false;
	const optionalRef = (actual: number | null) => {
		if (c.op === 'is_empty') return actual === null;
		if (c.op === 'is_not_empty') return actual !== null;
		return eqOrNot(actual, id(c.value));
	};
	switch (c.field) {
		case 'type':
			return eqOrNot(t.type, c.value);
		case 'status':
			return eqOrNot(t.status, c.value);
		case 'priority':
			if (c.op === 'gte') return rank(t.priority) >= rank(String(c.value));
			if (c.op === 'lte') return rank(t.priority) <= rank(String(c.value));
			return eqOrNot(t.priority, c.value);
		case 'assignee':
			return optionalRef(t.assigneeId);
		case 'reporter':
			return eqOrNot(t.reporterId, id(c.value));
		case 'label':
			if (c.op === 'has') return f.labelIds.includes(Number(c.value));
			if (c.op === 'has_not') return !f.labelIds.includes(Number(c.value));
			return false;
		case 'milestone':
			return optionalRef(t.milestoneId);
		case 'release':
			return optionalRef(t.releaseId);
		case 'votes':
			if (c.op === 'gte') return t.voteCount >= num(c.value);
			if (c.op === 'lte') return t.voteCount <= num(c.value);
			return false;
		case 'has_attachment':
			return c.op === 'is_true'
				? f.attachmentCount > 0
				: c.op === 'is_false'
					? f.attachmentCount === 0
					: false;
		case 'via_widget':
			return c.op === 'is_true'
				? t.source === 'widget'
				: c.op === 'is_false'
					? t.source !== 'widget'
					: false;
		case 'project':
			return eqOrNot(t.projectId, id(c.value));
		case 'title':
		case 'description': {
			const haystack = text(c.field === 'title' ? t.title : t.descriptionText);
			const needle = text(c.value).trim();
			if (!needle) return false;
			if (c.op === 'contains') return haystack.includes(needle);
			if (c.op === 'not_contains') return !haystack.includes(needle);
			return false;
		}
		case 'age_days': {
			const days = (now - t.createdAt.getTime()) / 864e5;
			if (c.op === 'gte') return days >= num(c.value);
			if (c.op === 'lte') return days <= num(c.value);
			return false;
		}
		case 'reporter_role':
			return eqOrNot(f.reporterRole, c.value);
		default:
			return false;
	}
}

export interface ConditionReport {
	matched: boolean;
	groups: { passed: boolean; conditions: { condition: AutomationCondition; passed: boolean }[] }[];
}

/** OR over groups, AND within a group. No groups = always matches. */
export function evaluateConditions(
	conditions: AutomationConditions,
	facts: TicketFacts,
	now = Date.now()
): ConditionReport {
	const groups = (conditions.any ?? []).map((g) => {
		const results = g.all.map((condition) => ({
			condition,
			passed: evaluateCondition(condition, facts, now)
		}));
		return { passed: results.every((r) => r.passed), conditions: results };
	});
	return { matched: !groups.length || groups.some((g) => g.passed), groups };
}

export const priorityLabel = (p: string) => PRIORITY_META[p as TicketPriority]?.label ?? p;
