import { and, asc, eq, sql } from 'drizzle-orm';
import {
	ACTION_META,
	type AutomationConditionSummary,
	type AutomationProtection,
	type AutomationRunAction,
	type AutomationRunStatus
} from '../../shared/constants';
import { getDb, schema } from '../db';
import { redact } from '../redact';
import type { Automation, OutboundJob, Project, Ticket } from '../db/schema';
import { registerHandler } from '../outbound/queue';
import { ActionError, firstOwner, runAction, type ActionContext } from './actions';
import {
	evaluateConditions,
	loadFacts,
	summarizeConditions,
	type ConditionReport
} from './conditions';
import { withChain, type AutomationJob, type Chain } from './triggers';

/**
 * Automation engine.
 *
 * Architecture: services queue an `automation` job (shared SQLite outbound queue) in the same
 * transaction as the change. The worker runs `processEvent`:
 *
 * 1. Load the project's enabled rules for the trigger, in a fixed order (position, id).
 * 2. For each rule, with fresh ticket data: evaluate trigger options and conditions.
 * 3. Run the matching rule's actions in their own transaction – all or nothing – and record the
 *    run (success with the list of actions, or the failure) in `automation_runs`.
 *
 * Loop prevention:
 * - every event carries its chain (depth and the rules that already ran in it);
 * - a rule never runs twice in one chain (A → B → A stops at the second A);
 * - chains stop at MAX_DEPTH levels of automation-caused events;
 * - both cases are recorded as `skipped` runs with the reason;
 * - actions that would not change anything are no-ops and queue no further events.
 *
 * Isolation: a failing rule never affects the change that triggered it (that is committed
 * already) nor other rules. Runs are unique per (event, rule), so a retried job never repeats
 * actions that already ran. Only infrastructure errors (e.g. the database being busy) make the
 * whole job retry.
 */

export const MAX_DEPTH = 5;

function rulesFor(job: Pick<AutomationJob, 'projectId' | 'trigger'>) {
	return getDb()
		.select()
		.from(schema.automations)
		.where(
			and(
				eq(schema.automations.projectId, job.projectId),
				eq(schema.automations.trigger, job.trigger),
				eq(schema.automations.enabled, true)
			)
		)
		.orderBy(asc(schema.automations.position), asc(schema.automations.id))
		.all();
}

/** Trigger options (currently the vote threshold) – must also hold for this event. */
export function triggerOptionsMatch(
	rule: Pick<Automation, 'trigger' | 'triggerConfig'>,
	data: Record<string, unknown>
) {
	if (rule.trigger === 'ticket.vote_threshold') {
		const n = Number(rule.triggerConfig.threshold);
		const previous = Number(data.previous ?? 0);
		const votes = Number(data.votes ?? 0);
		return Number.isFinite(n) && previous < n && votes >= n;
	}
	return true;
}

/** Account used as author of automated comments: the rule's creator if still staff, else an owner. */
function authorFor(rule: Pick<Automation, 'createdById'>, project: Project) {
	if (rule.createdById) {
		const staff = getDb()
			.select({
				id: schema.users.id,
				role: schema.users.role,
				member: schema.projectMembers.role,
				status: schema.users.status
			})
			.from(schema.users)
			.leftJoin(
				schema.projectMembers,
				and(
					eq(schema.projectMembers.userId, schema.users.id),
					eq(schema.projectMembers.projectId, project.id)
				)
			)
			.where(eq(schema.users.id, rule.createdById))
			.get();
		if (
			staff?.status === 'active' &&
			(staff.role === 'admin' || staff.member === 'owner' || staff.member === 'moderator')
		)
			return staff.id;
	}
	return firstOwner(getDb(), project.id) ?? null;
}

function record(
	rule: Pick<Automation, 'id' | 'name'>,
	job: AutomationJob,
	status: AutomationRunStatus,
	actions: AutomationRunAction[],
	error: string | null,
	started: number,
	tx = getDb(),
	extra: { protection?: AutomationProtection; conditions?: AutomationConditionSummary } = {}
) {
	const inserted = tx
		.insert(schema.automationRuns)
		.values({
			automationId: rule.id,
			automationName: rule.name,
			projectId: job.projectId,
			ticketId: job.ticketId,
			trigger: job.trigger,
			eventId: job.eventId,
			status,
			depth: job.chain.depth,
			actions,
			error: error?.slice(0, 500) ?? null,
			durationMs: Date.now() - started,
			protection: extra.protection ?? null,
			conditions: extra.conditions ?? null
		})
		.onConflictDoNothing()
		.run().changes;
	if (inserted && status !== 'skipped')
		tx.update(schema.automations)
			.set({
				lastRunAt: new Date(),
				runCount: sql`${schema.automations.runCount} + 1`,
				lastError: status === 'failed' ? (error?.slice(0, 300) ?? 'Failed') : null
			})
			.where(eq(schema.automations.id, rule.id))
			.run();
	return inserted > 0;
}

function alreadyRan(eventId: string, ruleId: number) {
	return !!getDb()
		.select({ id: schema.automationRuns.id })
		.from(schema.automationRuns)
		.where(
			and(
				eq(schema.automationRuns.eventId, eventId),
				eq(schema.automationRuns.automationId, ruleId)
			)
		)
		.get();
}

/** Processes one automation event. Returns per-rule outcomes (used by tests). */
export function processEvent(job: AutomationJob) {
	const outcomes: { ruleId: number; status: AutomationRunStatus | 'no_match' | 'duplicate' }[] = [];
	const project = getDb()
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.id, job.projectId))
		.get();
	if (!project || project.archivedAt || !job.ticketId) return outcomes;
	for (const rule of rulesFor(job)) {
		const started = Date.now();
		if (alreadyRan(job.eventId, rule.id)) {
			outcomes.push({ ruleId: rule.id, status: 'duplicate' });
			continue;
		}
		if (job.chain.rules.includes(rule.id) || job.chain.depth >= MAX_DEPTH) {
			const reason = job.chain.rules.includes(rule.id)
				? 'Skipped to prevent a loop: this rule already ran earlier in the same chain of automated changes.'
				: `Skipped to prevent a loop: more than ${MAX_DEPTH} automated changes in a row.`;
			record(rule, job, 'skipped', [], reason, started, getDb(), {
				protection: job.chain.rules.includes(rule.id) ? 'loop' : 'depth'
			});
			outcomes.push({ ruleId: rule.id, status: 'skipped' });
			continue;
		}
		// Fresh data for every rule: earlier rules may have changed the ticket.
		const facts = loadFacts(job.ticketId);
		if (!facts || facts.ticket.projectId !== project.id) break;
		const report = evaluateConditions(rule.conditions, facts);
		if (!triggerOptionsMatch(rule, job.data) || !report.matched) {
			outcomes.push({ ruleId: rule.id, status: 'no_match' });
			continue;
		}
		const authorId = authorFor(rule, project);
		const chain: Chain = {
			depth: job.chain.depth + 1,
			rules: [...job.chain.rules, rule.id],
			root: job.chain.root
		};
		const actions: AutomationRunAction[] = [];
		const conditionSummary = summarizeConditions(report, project.id);
		try {
			getDb().transaction(
				(tx) => {
					if (
						!authorId &&
						rule.actions.some((a) => a.type === 'internal_note' || a.type === 'public_comment')
					)
						throw new ActionError(
							'No active owner can be used as the author of automated comments'
						);
					const ctx: ActionContext = {
						tx,
						project,
						ticket: facts.ticket,
						rule,
						authorId: authorId ?? 0,
						dryRun: false
					};
					withChain(chain, () => {
						for (const action of rule.actions) {
							try {
								actions.push(runAction(ctx, action));
							} catch (err) {
								actions.push({
									type: action.type,
									summary: 'Failed',
									ok: false,
									changed: false,
									error: err instanceof Error ? err.message : String(err)
								});
								throw err;
							}
						}
					});
					record(rule, job, 'success', actions, null, started, tx, {
						conditions: conditionSummary
					});
				},
				{ behavior: 'immediate' }
			);
			outcomes.push({ ruleId: rule.id, status: 'success' });
		} catch (err) {
			if (!(err instanceof ActionError) && isInfrastructureError(err)) throw err;
			const message = err instanceof Error ? err.message : String(err);
			// The rule's changes were rolled back; record what was attempted.
			record(
				rule,
				job,
				'failed',
				[
					...actions.map((a) =>
						a.ok ? { ...a, summary: `${a.summary} (rolled back)`, changed: false } : a
					),
					// Actions after the failing one were never attempted.
					...rule.actions.slice(actions.length).map((a): AutomationRunAction => ({
						type: a.type,
						summary: `${ACTION_META[a.type]?.label ?? a.type} – not run`,
						ok: true,
						changed: false,
						skipped: true
					}))
				],
				sanitizeRunError(message),
				started,
				getDb(),
				{ conditions: conditionSummary }
			);
			outcomes.push({ ruleId: rule.id, status: 'failed' });
		}
	}
	return outcomes;
}

/**
 * Error text shown in the run history: rule-level messages are kept, but anything that looks
 * like a URL, a token or a stack trace is removed (destinations and secrets never leak).
 */
export function sanitizeRunError(message: string) {
	return redact(message);
}

/** Busy/locked database and similar: worth retrying the whole job later. */
function isInfrastructureError(err: unknown) {
	const code = (err as { code?: string })?.code ?? '';
	return /SQLITE_BUSY|SQLITE_LOCKED|SQLITE_IOERR|SQLITE_FULL/.test(code);
}

registerHandler('automation', async (job: OutboundJob) => {
	processEvent(job.payload as unknown as AutomationJob);
});

// ── Testing a rule ─────────────────────────────────────────────────────────

export interface RuleTestResult {
	ticket: { number: number; title: string };
	conditions: ConditionReport;
	triggerNote: string | null;
	actions: AutomationRunAction[];
	wouldRun: boolean;
}

/**
 * Dry run of a (possibly unsaved) rule against an existing ticket: evaluates the conditions and
 * describes what each action would do. Runs inside a transaction that is always rolled back,
 * so nothing is ever written.
 */
export function testRule(
	project: Project,
	rule: Pick<
		Automation,
		'id' | 'name' | 'createdById' | 'trigger' | 'triggerConfig' | 'conditions' | 'actions'
	>,
	ticket: Ticket
): RuleTestResult {
	const facts = loadFacts(ticket.id)!;
	const conditions = evaluateConditions(rule.conditions, facts);
	const actions: AutomationRunAction[] = [];
	const triggerNote =
		rule.trigger === 'ticket.vote_threshold'
			? `Runs when the vote count reaches ${rule.triggerConfig.threshold} (this ticket has ${ticket.voteCount}).`
			: null;
	const rollback = new Error('dry run');
	try {
		getDb().transaction((tx) => {
			const ctx: ActionContext = {
				tx,
				project,
				ticket: facts.ticket,
				rule,
				authorId: 0,
				dryRun: true
			};
			for (const action of rule.actions) {
				try {
					actions.push(runAction(ctx, action));
				} catch (err) {
					actions.push({
						type: action.type,
						summary: 'Would fail',
						ok: false,
						changed: false,
						error: err instanceof Error ? err.message : String(err)
					});
				}
			}
			throw rollback;
		});
	} catch (err) {
		if (err !== rollback) throw err;
	}
	return {
		ticket: { number: ticket.number, title: ticket.title },
		conditions,
		triggerNote,
		actions,
		wouldRun: conditions.matched
	};
}
