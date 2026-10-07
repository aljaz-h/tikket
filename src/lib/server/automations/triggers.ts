import { and, eq, sql } from 'drizzle-orm';
import type { AutomationTrigger, TicketStatus } from '../../shared/constants';
import { statusEffect } from '../../shared/workflow';
import { randomId } from '../auth/tokens';
import { getDb, schema, type DB } from '../db';
import { enqueue } from '../outbound/queue';

/**
 * Automation events.
 *
 * Services call `fireTrigger` inside the transaction of the change that happened. If the project
 * has an enabled rule for that trigger (one indexed lookup), an `automation` job is queued in the
 * same transaction; the queue worker evaluates and runs the rules afterwards. Nothing is queued
 * for projects without matching rules, and a rolled-back change never triggers anything.
 *
 * Every event carries its execution chain: the depth (0 for something a person or an
 * integration did) and the rules that already ran in this chain. While rule actions execute,
 * `withChain` makes that chain current, so changes made by automations queue their follow-up
 * events with depth + 1 – the basis of loop prevention (see engine.ts).
 */

export interface Chain {
	depth: number;
	/** Rule ids that already ran in this chain, in order. */
	rules: number[];
	/** Id of the event that started the chain. */
	root: string;
}

export interface AutomationJob {
	trigger: AutomationTrigger;
	projectId: number;
	ticketId: number | null;
	eventId: string;
	data: Record<string, unknown>;
	chain: Chain;
	summary: string;
}

let current: Chain | null = null;

/** Runs `fn` (synchronously) with `chain` as the current automation chain. */
export function withChain<T>(chain: Chain, fn: () => T): T {
	const previous = current;
	current = chain;
	try {
		return fn();
	} finally {
		current = previous;
	}
}

export function currentChain() {
	return current;
}

export function hasRules(tx: Pick<DB, 'select'>, projectId: number, trigger: AutomationTrigger) {
	return !!tx
		.select({ id: schema.automations.id })
		.from(schema.automations)
		.where(
			and(
				eq(schema.automations.projectId, projectId),
				eq(schema.automations.trigger, trigger),
				eq(schema.automations.enabled, true)
			)
		)
		.limit(1)
		.get();
}

export const MAX_CHAIN_EVENTS = 50;

function chainEvents(tx: DB, root: string) {
	return (
		tx
			.select({ n: sql<number>`count(*)` })
			.from(schema.outboundJobs)
			.where(
				and(
					eq(schema.outboundJobs.kind, 'automation'),
					sql`json_extract(${schema.outboundJobs.payload}, '$.chain.root') = ${root}`
				)
			)
			.get()?.n ?? 0
	);
}

/** Queues automation processing for an event if any enabled rule listens to it. */
export function fireTrigger(
	tx: DB,
	projectId: number,
	trigger: AutomationTrigger,
	ticketId: number | null,
	data: Record<string, unknown> = {}
) {
	if (!hasRules(tx, projectId, trigger)) return false;
	// Fan-out guard: one person's change may cause at most MAX_CHAIN_EVENTS automated events in
	// total (many rules reacting to each other's changes would otherwise multiply jobs).
	if (current && chainEvents(tx, current.root) >= MAX_CHAIN_EVENTS) {
		console.warn(
			`[tikket] automation chain ${current.root} reached ${MAX_CHAIN_EVENTS} events; stopped`
		);
		return false;
	}
	const eventId = `aev_${randomId(12)}`;
	const job: AutomationJob = {
		trigger,
		projectId,
		ticketId,
		eventId,
		data,
		chain: current ?? { depth: 0, rules: [], root: eventId },
		summary: `${trigger}${ticketId ? ` #${ticketId}` : ''}`
	};
	enqueue(
		{
			kind: 'automation',
			payload: job as unknown as Record<string, unknown>,
			dedupeKey: `automation:${eventId}`,
			projectId,
			maxAttempts: 3
		},
		tx
	);
	return true;
}

/** Vote thresholds are only an event when a rule's threshold was actually crossed. */
export function fireVoteThreshold(
	tx: DB,
	projectId: number,
	ticketId: number,
	previous: number,
	votes: number
) {
	if (votes <= previous) return false;
	const rules = tx
		.select({ config: schema.automations.triggerConfig })
		.from(schema.automations)
		.where(
			and(
				eq(schema.automations.projectId, projectId),
				eq(schema.automations.trigger, 'ticket.vote_threshold'),
				eq(schema.automations.enabled, true)
			)
		)
		.all();
	const crossed = rules.some((r) => {
		const n = Number(r.config.threshold);
		return Number.isFinite(n) && previous < n && votes >= n;
	});
	return crossed
		? fireTrigger(tx, projectId, 'ticket.vote_threshold', ticketId, { previous, votes })
		: false;
}

/** Convenience for code outside a transaction (e.g. the GitHub webhook). */
export function fireTriggerNow(
	projectId: number,
	trigger: AutomationTrigger,
	ticketId: number | null,
	data: Record<string, unknown> = {}
) {
	return getDb().transaction((tx) => fireTrigger(tx, projectId, trigger, ticketId, data));
}

/** Automation triggers for a status change: changed, plus completed or reopened. */
export function fireStatusTriggers(
	tx: DB,
	projectId: number,
	ticketId: number,
	from: TicketStatus,
	to: TicketStatus
) {
	if (from === to) return;
	fireTrigger(tx, projectId, 'ticket.status_changed', ticketId, { from, to });
	if (to === 'completed') fireTrigger(tx, projectId, 'ticket.completed', ticketId, { from });
	if (statusEffect(from, to) === 'reopened')
		fireTrigger(tx, projectId, 'ticket.reopened', ticketId, { from, to });
}
