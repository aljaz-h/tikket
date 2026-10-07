import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	ACTION_TYPES,
	AUTOMATION_RUN_STATUSES,
	AUTOMATION_TRIGGERS,
	CONDITION_FIELDS,
	CONDITION_OPS,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES,
	type AutomationAction,
	type AutomationCondition,
	type AutomationRunStatus
} from '../../shared/constants';
import { FIELD_OPS, PEOPLE_TARGETS, REPORTER_ROLES } from '../../shared/automation';
import type { ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Automation } from '../db/schema';
import { audit } from '../services/audit';
import { createLabel, isAssignable } from '../services/projects';
import { ServiceError } from '../services/users';

/** Owners and moderators manage automations (as they manage tickets). */
export function requireAutomationManager(access: ProjectAccess) {
	if (!access.isStaff || access.archived)
		throw new ServiceError(
			'Only project owners and moderators can manage automations',
			'form',
			403
		);
}

export const MAX_GROUPS = 5;
export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 10;

const condition = z.object({
	field: z.enum(CONDITION_FIELDS),
	op: z.enum(CONDITION_OPS),
	value: z.union([z.string().max(200), z.number(), z.null()]).optional()
});
const action = z.object({
	type: z.enum(ACTION_TYPES),
	value: z.union([z.string().max(50), z.number(), z.null()]).optional(),
	text: z.string().max(4000).nullable().optional()
});
export const ruleInput = z.object({
	name: z.string().trim().min(1, 'Give the rule a name').max(80),
	description: z.string().trim().max(300).nullable().optional(),
	enabled: z.boolean(),
	trigger: z.enum(AUTOMATION_TRIGGERS),
	triggerConfig: z
		.object({ threshold: z.number().int().min(1).max(1_000_000).optional() })
		.default({}),
	conditions: z
		.object({
			any: z
				.array(z.object({ all: z.array(condition).min(1).max(MAX_CONDITIONS) }))
				.max(MAX_GROUPS, `At most ${MAX_GROUPS} condition groups`)
		})
		.default({ any: [] }),
	actions: z.array(action).min(1, 'Add at least one action').max(MAX_ACTIONS)
});
export type RuleInput = z.infer<typeof ruleInput>;

export { FIELD_OPS, REPORTER_ROLES, PEOPLE_TARGETS };

const fail = (message: string): never => {
	throw new ServiceError(message, 'form');
};

function inProject(
	table: 'labels' | 'milestones' | 'releases' | 'hooks',
	projectId: number,
	id: number
) {
	const db = getDb();
	const t =
		table === 'labels'
			? schema.ticketLabels
			: table === 'milestones'
				? schema.milestones
				: table === 'releases'
					? schema.changelogEntries
					: schema.projectHooks;
	return !!db
		.select({ id: t.id })
		.from(t)
		.where(and(eq(t.id, id), eq(t.projectId, projectId)))
		.get();
}

function userExists(id: number) {
	return !!getDb()
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(eq(schema.users.id, id))
		.get();
}

/** Notify/follow targets must belong to the project (no messages to arbitrary accounts). */
function isMember(projectId: number, id: number) {
	return !!getDb()
		.select({ id: schema.projectMembers.userId })
		.from(schema.projectMembers)
		.where(
			and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, id))
		)
		.get();
}

function validCondition(c: AutomationCondition, projectId: number) {
	if (!FIELD_OPS[c.field].includes(c.op)) fail(`“${c.op}” cannot be used with ${c.field}`);
	if (['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(c.op))
		return { ...c, value: null };
	const v = c.value;
	if (v === null || v === undefined || v === '') fail(`Choose a value for ${c.field}`);
	const n = Number(v);
	switch (c.field) {
		case 'type':
			if (!(TICKET_TYPES as readonly string[]).includes(String(v))) fail('Unknown ticket type');
			break;
		case 'status':
			if (!(TICKET_STATUSES as readonly string[]).includes(String(v))) fail('Unknown status');
			break;
		case 'priority':
			if (!(TICKET_PRIORITIES as readonly string[]).includes(String(v))) fail('Unknown priority');
			break;
		case 'reporter_role':
			if (!(REPORTER_ROLES as readonly string[]).includes(String(v))) fail('Unknown role');
			break;
		case 'label':
			if (!inProject('labels', projectId, n)) fail('That label does not belong to this project');
			return { ...c, value: n };
		case 'milestone':
			if (!inProject('milestones', projectId, n))
				fail('That milestone does not belong to this project');
			return { ...c, value: n };
		case 'release':
			if (!inProject('releases', projectId, n))
				fail('That release does not belong to this project');
			return { ...c, value: n };
		case 'assignee':
		case 'reporter':
			if (!Number.isInteger(n) || !userExists(n)) fail('Unknown person');
			return { ...c, value: n };
		case 'project':
			if (n !== projectId) fail('Rules only apply to their own project');
			return { ...c, value: n };
		case 'votes':
		case 'age_days':
			if (!Number.isFinite(n) || n < 0 || n > 1_000_000) fail(`Enter a number for ${c.field}`);
			return { ...c, value: n };
		case 'title':
		case 'description':
			return { ...c, value: String(v).trim().slice(0, 200) };
	}
	return { ...c, value: String(v) };
}

function validAction(a: AutomationAction, projectId: number): AutomationAction {
	const n = Number(a.value);
	const text = a.text?.trim() || null;
	switch (a.type) {
		case 'set_status':
			if (
				!(TICKET_STATUSES as readonly string[]).includes(String(a.value)) ||
				a.value === 'duplicate'
			)
				fail('Choose a status (Duplicate is not available for automations)');
			return { type: a.type, value: String(a.value), text };
		case 'set_priority':
			if (!(TICKET_PRIORITIES as readonly string[]).includes(String(a.value)))
				fail('Choose a priority');
			return { type: a.type, value: String(a.value) };
		case 'assign':
			if (a.value === 'owner') return { type: a.type, value: 'owner' };
			if (!isAssignable(projectId, n)) fail('Tickets can only be assigned to project staff');
			return { type: a.type, value: n };
		case 'add_label':
		case 'remove_label':
			if (!inProject('labels', projectId, n)) fail('That label does not belong to this project');
			return { type: a.type, value: n };
		case 'set_milestone':
			if (!inProject('milestones', projectId, n))
				fail('That milestone does not belong to this project');
			return { type: a.type, value: n };
		case 'set_release':
			if (!inProject('releases', projectId, n))
				fail('That release does not belong to this project');
			return { type: a.type, value: n };
		case 'trigger_hook':
			if (!inProject('hooks', projectId, n))
				fail('That destination does not belong to this project');
			return { type: a.type, value: n, text: text?.slice(0, 300) ?? null };
		case 'follow':
		case 'notify': {
			const target = String(a.value ?? '');
			if (!(PEOPLE_TARGETS as readonly string[]).includes(target)) {
				if (!Number.isInteger(n) || !isMember(projectId, n))
					fail('Choose a member of this project to notify or add as follower');
			}
			return {
				type: a.type,
				value: target,
				text: a.type === 'notify' ? (text?.slice(0, 300) ?? null) : null
			};
		}
		case 'internal_note':
		case 'public_comment':
			if (!text) fail('Enter the text of the note or comment');
			return { type: a.type, text: text!.slice(0, 4000) };
		case 'clear_assignee':
		case 'clear_milestone':
		case 'clear_release':
			return { type: a.type };
	}
	return fail('Unknown action');
}

/** Validates a rule and every project reference in it (cross-project references are refused). */
export const MAX_RULES = 50;

/** Hook destinations are configured by owners, so only owners may send to them from rules. */
function requireHookRights(access: ProjectAccess, rule: { actions: { type: string }[] }) {
	if (!access.isOwner && rule.actions.some((a) => a.type === 'trigger_hook'))
		fail('Only project owners can send to Discord or webhook destinations from automations');
}

export function normaliseRule(input: unknown, projectId: number) {
	const parsed = ruleInput.safeParse(input);
	if (!parsed.success) fail(parsed.error.issues[0].message);
	const rule = parsed.data!;
	if (rule.trigger === 'ticket.vote_threshold' && !rule.triggerConfig.threshold)
		fail('Enter the number of votes');
	return {
		...rule,
		description: rule.description || null,
		triggerConfig:
			rule.trigger === 'ticket.vote_threshold' ? { threshold: rule.triggerConfig.threshold } : {},
		conditions: {
			any: rule.conditions.any.map((g) => ({ all: g.all.map((c) => validCondition(c, projectId)) }))
		},
		actions: rule.actions.map((a) => validAction(a, projectId))
	};
}

export function listRules(projectId: number) {
	return getDb()
		.select()
		.from(schema.automations)
		.where(eq(schema.automations.projectId, projectId))
		.orderBy(schema.automations.position, schema.automations.id)
		.all();
}

export function getRule(projectId: number, id: number): Automation | undefined {
	return getDb()
		.select()
		.from(schema.automations)
		.where(and(eq(schema.automations.projectId, projectId), eq(schema.automations.id, id)))
		.get();
}

export function createRule(
	actorId: number,
	access: ProjectAccess,
	input: unknown,
	ip: string | null
) {
	requireAutomationManager(access);
	const rule = normaliseRule(input, access.project.id);
	requireHookRights(access, rule);
	if (listRules(access.project.id).length >= MAX_RULES)
		fail(`A project can have at most ${MAX_RULES} automations`);
	const position =
		(getDb()
			.select({ n: max(schema.automations.position) })
			.from(schema.automations)
			.where(eq(schema.automations.projectId, access.project.id))
			.get()?.n ?? 0) + 1;
	const created = getDb()
		.insert(schema.automations)
		.values({
			...rule,
			projectId: access.project.id,
			position,
			createdById: actorId,
			updatedById: actorId
		})
		.returning()
		.get();
	audit({
		actorId,
		action: 'automation.created',
		targetType: 'project',
		targetId: access.project.id,
		data: {
			automationId: created.id,
			name: created.name,
			trigger: created.trigger,
			enabled: created.enabled
		},
		ip
	});
	return created;
}

export function updateRule(
	actorId: number,
	access: ProjectAccess,
	id: number,
	input: unknown,
	ip: string | null
) {
	requireAutomationManager(access);
	const existing = getRule(access.project.id, id);
	if (!existing) throw new ServiceError('Automation not found', 'form', 404);
	const rule = normaliseRule(input, access.project.id);
	requireHookRights(access, rule);
	getDb()
		.update(schema.automations)
		.set({ ...rule, updatedById: actorId, updatedAt: new Date(), lastError: null })
		.where(eq(schema.automations.id, id))
		.run();
	audit({
		actorId,
		action: 'automation.updated',
		targetType: 'project',
		targetId: access.project.id,
		data: { automationId: id, name: rule.name, trigger: rule.trigger, enabled: rule.enabled },
		ip
	});
}

export function setRuleEnabled(
	actorId: number,
	access: ProjectAccess,
	id: number,
	enabled: boolean,
	ip: string | null
) {
	requireAutomationManager(access);
	const existing = getRule(access.project.id, id);
	if (!existing) throw new ServiceError('Automation not found', 'form', 404);
	getDb()
		.update(schema.automations)
		.set({ enabled, updatedById: actorId, updatedAt: new Date() })
		.where(eq(schema.automations.id, id))
		.run();
	audit({
		actorId,
		action: 'automation.updated',
		targetType: 'project',
		targetId: access.project.id,
		data: { automationId: id, name: existing.name, enabled },
		ip
	});
}

/** Deleting a rule keeps its history (runs keep the rule's name). */
export function deleteRule(actorId: number, access: ProjectAccess, id: number, ip: string | null) {
	requireAutomationManager(access);
	const existing = getRule(access.project.id, id);
	if (!existing) throw new ServiceError('Automation not found', 'form', 404);
	getDb().delete(schema.automations).where(eq(schema.automations.id, id)).run();
	audit({
		actorId,
		action: 'automation.deleted',
		targetType: 'project',
		targetId: access.project.id,
		data: { automationId: id, name: existing.name },
		ip
	});
}

// ── Templates ──────────────────────────────────────────────────────────────

export const TEMPLATES = [
	{
		id: 'critical-bugs',
		name: 'Critical bug handling',
		description: 'When a critical bug is reported, assign the project owner and flag it for review.'
	},
	{
		id: 'popular-feature',
		name: 'Popular feature request',
		description: 'When a feature request reaches 10 votes, label it Popular and notify staff.'
	},
	{
		id: 'github-merge',
		name: 'Complete on pull request merge',
		description: 'When a linked pull request is merged, mark the ticket completed and comment.'
	},
	{
		id: 'pr-in-progress',
		name: 'In progress when a pull request is linked',
		description:
			'When a pull request is linked to an open or planned ticket, move it to In Progress.'
	}
] as const;
export type TemplateId = (typeof TEMPLATES)[number]['id'];

function labelId(access: ProjectAccess, name: string, color: string) {
	const existing = getDb()
		.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
		.from(schema.ticketLabels)
		.where(eq(schema.ticketLabels.projectId, access.project.id))
		.all()
		.find((l) => l.name.toLowerCase() === name.toLowerCase());
	if (existing) return existing.id;
	return createLabel(access.project.id, name, color).id;
}

/** Creates an editable, disabled rule from a template (labels it needs are created if missing). */
export function createFromTemplate(
	actorId: number,
	access: ProjectAccess,
	id: TemplateId,
	ip: string | null
) {
	requireAutomationManager(access);
	const tpl = TEMPLATES.find((t) => t.id === id);
	if (!tpl) throw new ServiceError('Unknown template', 'form', 404);
	const base = { name: tpl.name, description: tpl.description, enabled: false };
	const rule =
		id === 'critical-bugs'
			? {
					...base,
					trigger: 'ticket.created',
					conditions: {
						any: [
							{
								all: [
									{ field: 'type', op: 'is', value: 'bug' },
									{ field: 'priority', op: 'is', value: 'critical' }
								]
							}
						]
					},
					actions: [
						{ type: 'assign', value: 'owner' },
						{ type: 'add_label', value: labelId(access, 'Needs Review', 'rose') }
					]
				}
			: id === 'popular-feature'
				? {
						...base,
						trigger: 'ticket.vote_threshold',
						triggerConfig: { threshold: 10 },
						conditions: { any: [{ all: [{ field: 'type', op: 'is', value: 'feature' }] }] },
						actions: [
							{ type: 'add_label', value: labelId(access, 'Popular', 'amber') },
							{ type: 'notify', value: 'staff', text: 'This feature request reached 10 votes.' }
						]
					}
				: id === 'github-merge'
					? {
							...base,
							trigger: 'github.pull_request.merged',
							conditions: { any: [] },
							actions: [
								{ type: 'set_status', value: 'completed' },
								{ type: 'public_comment', text: 'The fix for this ticket was merged.' }
							]
						}
					: {
							...base,
							trigger: 'github.pull_request.linked',
							conditions: {
								any: [
									{ all: [{ field: 'status', op: 'is', value: 'open' }] },
									{ all: [{ field: 'status', op: 'is', value: 'planned' }] }
								]
							},
							actions: [{ type: 'set_status', value: 'in_progress' }]
						};
	return createRule(actorId, access, rule, ip);
}

// ── History ────────────────────────────────────────────────────────────────

export interface RunFilters {
	automationId?: number | null;
	status?: AutomationRunStatus | null;
	ticketId?: number | null;
	from?: Date | null;
	to?: Date | null;
	before?: number | null;
	/** Only runs where loop, depth or fan-out protection intervened. */
	protected?: boolean;
}

export const RUN_PAGE = 25;

/** Execution history, newest first, keyset-paginated (`before` = last id of the previous page). */
export function listRuns(projectId: number, f: RunFilters = {}) {
	const r = schema.automationRuns;
	const rows = getDb()
		.select({
			id: r.id,
			automationId: r.automationId,
			automationName: r.automationName,
			trigger: r.trigger,
			status: r.status,
			depth: r.depth,
			actions: r.actions,
			error: r.error,
			durationMs: r.durationMs,
			protection: r.protection,
			conditions: r.conditions,
			createdAt: r.createdAt,
			ticketNumber: schema.tickets.number,
			ticketTitle: schema.tickets.title
		})
		.from(r)
		.leftJoin(schema.tickets, eq(schema.tickets.id, r.ticketId))
		.where(
			and(
				eq(r.projectId, projectId),
				f.automationId ? eq(r.automationId, f.automationId) : undefined,
				f.status && (AUTOMATION_RUN_STATUSES as readonly string[]).includes(f.status)
					? eq(r.status, f.status)
					: undefined,
				f.ticketId ? eq(r.ticketId, f.ticketId) : undefined,
				f.protected ? isNotNull(r.protection) : undefined,
				f.from ? gte(r.createdAt, f.from) : undefined,
				f.to ? lte(r.createdAt, f.to) : undefined,
				f.before ? lt(r.id, f.before) : undefined
			)
		)
		.orderBy(desc(r.id))
		.limit(RUN_PAGE + 1)
		.all();
	return { runs: rows.slice(0, RUN_PAGE), more: rows.length > RUN_PAGE };
}

/**
 * Compact health summary for the Automations page (v0.7): rule counts, runs and failures in the
 * last 24 hours, safety-limit interventions and the most recent failure. Two small queries.
 */
export function automationHealth(projectId: number, now = Date.now()) {
	const r = schema.automationRuns;
	const since = new Date(now - 864e5);
	const rules = getDb()
		.select({ enabled: schema.automations.enabled, n: count() })
		.from(schema.automations)
		.where(eq(schema.automations.projectId, projectId))
		.groupBy(schema.automations.enabled)
		.all();
	const runs = getDb()
		.select({
			total: count(),
			failed: sql<number>`sum(case when ${r.status} = 'failed' then 1 else 0 end)`,
			protected: sql<number>`sum(case when ${r.protection} is not null then 1 else 0 end)`,
			dropped: sql<number>`sum(case when ${r.protection} = 'fanout' then 1 else 0 end)`
		})
		.from(r)
		.where(and(eq(r.projectId, projectId), gte(r.createdAt, since)))
		.get();
	const lastFailure = getDb()
		.select({ name: r.automationName, error: r.error, createdAt: r.createdAt })
		.from(r)
		.where(and(eq(r.projectId, projectId), eq(r.status, 'failed')))
		.orderBy(desc(r.id))
		.limit(1)
		.get();
	return {
		enabled: rules.find((x) => x.enabled)?.n ?? 0,
		disabled: rules.find((x) => !x.enabled)?.n ?? 0,
		runs24h: runs?.total ?? 0,
		failed24h: Number(runs?.failed ?? 0),
		protected24h: Number(runs?.protected ?? 0),
		dropped24h: Number(runs?.dropped ?? 0),
		lastFailure: lastFailure ?? null
	};
}

/** Runs per rule for the list page (one grouped query). */
export function ruleIds(projectId: number) {
	return listRules(projectId).map((r) => r.id);
}

export function rulesByIds(projectId: number, ids: number[]) {
	if (!ids.length) return [];
	return getDb()
		.select({ id: schema.automations.id, name: schema.automations.name })
		.from(schema.automations)
		.where(and(eq(schema.automations.projectId, projectId), inArray(schema.automations.id, ids)))
		.all();
}

/** Run history is kept for 90 days. */
export function pruneAutomationRuns(now = Date.now()) {
	return getDb()
		.delete(schema.automationRuns)
		.where(lt(schema.automationRuns.createdAt, new Date(now - 90 * 864e5)))
		.run().changes;
}
