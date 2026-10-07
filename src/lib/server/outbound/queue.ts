import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { JobKind } from '../../shared/constants';
import { config } from '../config';
import { getDb, schema, type DB } from '../db';
import type { OutboundJob } from '../db/schema';

/**
 * One small, persistent outbound delivery queue for email, Discord and webhooks.
 *
 * - Jobs are rows in SQLite (the data volume), inserted in the same transaction as the action
 *   that caused them, so nothing is sent for a rolled-back action and nothing is lost on restart.
 * - A worker in the app process claims due jobs with a single UPDATE … RETURNING and a lease.
 *   A crashed or killed process leaves its jobs `running`; they are picked up again once the
 *   lease expires. Only one process may serve a data volume (as for the rest of Tikket).
 * - Temporary failures are retried with capped exponential backoff and jitter; permanent
 *   failures and jobs out of attempts are marked `dead` (visible to administrators).
 * - Delivery failures never propagate to the action that queued the job.
 */

export class DeliveryError extends Error {
	constructor(
		message: string,
		/** Worth retrying (timeouts, connection errors, 429, 5xx). */
		readonly retryable: boolean,
		/** Server-requested delay (e.g. Retry-After), capped by the queue. */
		readonly retryAfterMs?: number
	) {
		super(message);
	}
}

export type JobHandler = (job: OutboundJob) => Promise<void>;
const handlers = new Map<JobKind, JobHandler>();

export function registerHandler(kind: JobKind, handler: JobHandler) {
	handlers.set(kind, handler);
}

export interface EnqueueInput {
	kind: JobKind;
	payload: Record<string, unknown>;
	dedupeKey?: string;
	projectId?: number | null;
	hookId?: number | null;
	maxAttempts?: number;
	delayMs?: number;
}

/** Queues a job (inside the caller's transaction when given). Duplicate dedupe keys are ignored. */
export function enqueue(input: EnqueueInput, tx: DB = getDb()): boolean {
	const inserted = tx
		.insert(schema.outboundJobs)
		.values({
			kind: input.kind,
			payload: input.payload,
			dedupeKey: input.dedupeKey ?? null,
			projectId: input.projectId ?? null,
			hookId: input.hookId ?? null,
			maxAttempts: input.maxAttempts ?? DEFAULT_ATTEMPTS[input.kind],
			nextAttemptAt: new Date(Date.now() + (input.delayMs ?? 0))
		})
		.onConflictDoNothing()
		.run().changes;
	if (inserted) kick();
	return inserted > 0;
}

const DEFAULT_ATTEMPTS: Record<JobKind, number> = {
	email: 6,
	discord: 6,
	webhook: 8,
	automation: 3
};
const LEASE_MS = 2 * 60 * 1000;
const BASE_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;
const CONCURRENCY = 4;
const ERROR_LENGTH = 300;

/** Delay before attempt n+1 after n failed attempts: 30 s, 1 min, 2 min … capped at 1 h, ±20 %. */
export function backoffMs(attempts: number, random = Math.random) {
	const base = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
	return Math.round(base * (0.8 + random() * 0.4));
}

/** Atomically claims up to `limit` due jobs (pending and due, or running with an expired lease). */
export function claimJobs(limit: number, now = new Date()): OutboundJob[] {
	if (limit <= 0) return [];
	const due = sql`(select ${schema.outboundJobs.id} from ${schema.outboundJobs}
		where (${schema.outboundJobs.status} = 'pending' and ${schema.outboundJobs.nextAttemptAt} <= ${now.getTime()})
		   or (${schema.outboundJobs.status} = 'running' and ${schema.outboundJobs.leaseUntil} < ${now.getTime()})
		order by ${schema.outboundJobs.nextAttemptAt} limit ${limit})`;
	return getDb()
		.update(schema.outboundJobs)
		.set({
			status: 'running',
			attempts: sql`${schema.outboundJobs.attempts} + 1`,
			leaseUntil: new Date(now.getTime() + LEASE_MS),
			updatedAt: now
		})
		.where(inArray(schema.outboundJobs.id, due))
		.returning()
		.all();
}

function clip(message: string) {
	const clean = message.replace(/\s+/g, ' ').trim();
	return clean.length > ERROR_LENGTH ? `${clean.slice(0, ERROR_LENGTH - 1)}…` : clean;
}

/** Runs one claimed job and records the outcome. Never throws. */
export async function runJob(job: OutboundJob): Promise<'done' | 'retry' | 'dead'> {
	const handler = handlers.get(job.kind);
	let outcome: 'done' | 'retry' | 'dead';
	let error: string | null = null;
	let retryAfter: number | undefined;
	try {
		if (!handler) throw new DeliveryError(`No handler for ${job.kind} jobs`, false);
		await handler(job);
		outcome = 'done';
	} catch (err) {
		const retryable = err instanceof DeliveryError ? err.retryable : true;
		retryAfter = err instanceof DeliveryError ? err.retryAfterMs : undefined;
		error = clip(err instanceof Error ? err.message : String(err));
		outcome = retryable && job.attempts < job.maxAttempts ? 'retry' : 'dead';
	}
	const now = new Date();
	try {
		getDb()
			.update(schema.outboundJobs)
			.set(
				outcome === 'done'
					? { status: 'done', leaseUntil: null, lastError: null, finishedAt: now, updatedAt: now }
					: outcome === 'retry'
						? {
								status: 'pending',
								leaseUntil: null,
								lastError: error,
								updatedAt: now,
								nextAttemptAt: new Date(
									now.getTime() +
										Math.min(Math.max(retryAfter ?? 0, backoffMs(job.attempts)), MAX_DELAY_MS)
								)
							}
						: {
								status: 'dead',
								leaseUntil: null,
								lastError: error,
								finishedAt: now,
								updatedAt: now
							}
			)
			.where(eq(schema.outboundJobs.id, job.id))
			.run();
	} catch (err) {
		console.error('[tikket] could not record outbound job result', err);
	}
	return outcome;
}

// ── Worker ─────────────────────────────────────────────────────────────────

const inflight = new Set<Promise<unknown>>();
let timer: ReturnType<typeof setInterval> | null = null;
let stopping = false;
let scheduled = false;

function tick() {
	if (stopping) return;
	let jobs: OutboundJob[];
	try {
		jobs = claimJobs(CONCURRENCY - inflight.size);
	} catch (err) {
		console.error('[tikket] outbound queue: claiming jobs failed', err);
		return;
	}
	for (const job of jobs) {
		const p = runJob(job).finally(() => {
			inflight.delete(p);
			if (!stopping) kick();
		});
		inflight.add(p);
	}
}

/** Runs the worker soon (after the current transaction has committed). */
function kick() {
	if (!timer || stopping || scheduled) return;
	scheduled = true;
	setTimeout(() => {
		scheduled = false;
		tick();
	}, 50).unref();
}

export function startWorker(intervalMs = 5000) {
	if (timer) return;
	stopping = false;
	timer = setInterval(tick, intervalMs);
	timer.unref();
	kick();
}

/** Stops claiming new jobs and waits (bounded) for running deliveries to finish. */
export async function stopWorker(timeoutMs = 10_000) {
	stopping = true;
	if (timer) clearInterval(timer);
	timer = null;
	if (!inflight.size) return;
	await Promise.race([
		Promise.allSettled([...inflight]),
		new Promise((r) => setTimeout(r, timeoutMs).unref())
	]);
}

/** Runs every due job now and waits for them (tests and the "send now" admin action). */
export async function drainQueue(maxRounds = 20) {
	for (let i = 0; i < maxRounds; i++) {
		const jobs = claimJobs(50);
		if (!jobs.length) return;
		await Promise.all(jobs.map(runJob));
	}
}

// ── Maintenance & visibility ───────────────────────────────────────────────

/** Removes delivered jobs after 7 days and dead ones after 30 days. */
export function pruneJobs(now = Date.now()) {
	return getDb()
		.delete(schema.outboundJobs)
		.where(
			or(
				and(
					eq(schema.outboundJobs.status, 'done'),
					lt(schema.outboundJobs.finishedAt, new Date(now - 7 * 864e5))
				),
				and(
					eq(schema.outboundJobs.status, 'dead'),
					lt(schema.outboundJobs.finishedAt, new Date(now - 30 * 864e5))
				)
			)
		)
		.run().changes;
}

export function queueStats(kind?: JobKind) {
	const rows = getDb()
		.select({ status: schema.outboundJobs.status, n: sql<number>`count(*)` })
		.from(schema.outboundJobs)
		.where(kind ? eq(schema.outboundJobs.kind, kind) : undefined)
		.groupBy(schema.outboundJobs.status)
		.all();
	const stats = { pending: 0, running: 0, done: 0, dead: 0 };
	for (const r of rows) stats[r.status] = r.n;
	return stats;
}

/** Recent failed (dead) jobs and jobs waiting for a retry – error excerpts only. */
export function recentProblems(kind: JobKind, limit = 10) {
	return getDb()
		.select({
			id: schema.outboundJobs.id,
			status: schema.outboundJobs.status,
			attempts: schema.outboundJobs.attempts,
			maxAttempts: schema.outboundJobs.maxAttempts,
			lastError: schema.outboundJobs.lastError,
			nextAttemptAt: schema.outboundJobs.nextAttemptAt,
			updatedAt: schema.outboundJobs.updatedAt,
			summary: sql<string | null>`json_extract(${schema.outboundJobs.payload}, '$.summary')`
		})
		.from(schema.outboundJobs)
		.where(
			and(
				eq(schema.outboundJobs.kind, kind),
				sql`(${schema.outboundJobs.status} = 'dead' or (${schema.outboundJobs.status} = 'pending' and ${schema.outboundJobs.lastError} is not null))`
			)
		)
		.orderBy(desc(schema.outboundJobs.updatedAt))
		.limit(limit)
		.all();
}

/** Puts a dead job back in the queue (administrator action). */
export function retryJob(id: number) {
	return (
		getDb()
			.update(schema.outboundJobs)
			.set({
				status: 'pending',
				attempts: 0,
				nextAttemptAt: new Date(),
				finishedAt: null,
				updatedAt: new Date()
			})
			.where(and(eq(schema.outboundJobs.id, id), eq(schema.outboundJobs.status, 'dead')))
			.run().changes > 0
	);
}

/** True when the worker should run in this process (not during unit tests). */
export function workerEnabled() {
	return !config.isTest && process.env.TIKKET_DISABLE_WORKER !== 'true';
}
