import { and, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { JOB_KINDS, type JobKind } from '../../shared/constants';
import { getDb, schema } from '../db';
import { redact } from '../redact';
import { audit } from '../services/audit';
import { ServiceError } from '../services/users';

/**
 * Operational view of the shared delivery queue (Administration → Delivery queue) and the
 * project-level failure list for owners. Only metadata is exposed: job kind, project, related
 * ticket, attempts, timestamps and a redacted error excerpt – never payloads, destination URLs,
 * secrets or message bodies.
 */

const j = schema.outboundJobs;
export type QueueFilter = 'failed' | 'retrying' | 'pending';
export const QUEUE_PAGE = 25;

export function queueOverview(now = Date.now()) {
	const db = getDb();
	const row = db
		.select({
			pending: sql<number>`sum(case when ${j.status} = 'pending' and ${j.lastError} is null then 1 else 0 end)`,
			retrying: sql<number>`sum(case when ${j.status} = 'pending' and ${j.lastError} is not null then 1 else 0 end)`,
			running: sql<number>`sum(case when ${j.status} = 'running' then 1 else 0 end)`,
			failed: sql<number>`sum(case when ${j.status} = 'dead' then 1 else 0 end)`,
			doneRecently: sql<number>`sum(case when ${j.status} = 'done' and ${j.finishedAt} >= ${now - 864e5} then 1 else 0 end)`,
			oldestPending: sql<
				number | null
			>`min(case when ${j.status} = 'pending' then ${j.createdAt} end)`,
			lastSuccess: sql<number | null>`max(case when ${j.status} = 'done' then ${j.finishedAt} end)`,
			lastFailure: sql<
				number | null
			>`max(case when ${j.lastError} is not null then ${j.updatedAt} end)`
		})
		.from(j)
		.get();
	const n = (v: number | null | undefined) => Number(v ?? 0);
	const d = (v: number | null | undefined) => (v ? new Date(Number(v)) : null);
	return {
		pending: n(row?.pending),
		retrying: n(row?.retrying),
		running: n(row?.running),
		failed: n(row?.failed),
		doneRecently: n(row?.doneRecently),
		oldestPending: d(row?.oldestPending),
		lastSuccess: d(row?.lastSuccess),
		lastFailure: d(row?.lastFailure)
	};
}

function filterWhere(filter: QueueFilter): SQL {
	if (filter === 'failed') return eq(j.status, 'dead');
	if (filter === 'retrying') return and(eq(j.status, 'pending'), isNotNull(j.lastError))!;
	return eq(j.status, 'pending');
}

/** The ticket a job is about (payload.ticketId for email/automation, the envelope for webhooks). */
const ticketIdExpr = sql<number | null>`coalesce(
	json_extract(${j.payload}, '$.ticketId'),
	json_extract(${j.payload}, '$.envelope.data.ticket.id')
)`;

export function listQueueJobs(f: {
	filter: QueueFilter;
	kind?: JobKind | null;
	projectId?: number | null;
	before?: number | null;
}) {
	const rows = getDb()
		.select({
			id: j.id,
			kind: j.kind,
			status: j.status,
			attempts: j.attempts,
			maxAttempts: j.maxAttempts,
			lastError: j.lastError,
			nextAttemptAt: j.nextAttemptAt,
			createdAt: j.createdAt,
			updatedAt: j.updatedAt,
			projectId: j.projectId,
			projectKey: schema.projects.key,
			projectName: schema.projects.name,
			ticketId: ticketIdExpr,
			summary: sql<string | null>`json_extract(${j.payload}, '$.summary')`
		})
		.from(j)
		.leftJoin(schema.projects, eq(schema.projects.id, j.projectId))
		.where(
			and(
				filterWhere(f.filter),
				f.kind ? eq(j.kind, f.kind) : undefined,
				f.projectId ? eq(j.projectId, f.projectId) : undefined,
				f.before ? sql`${j.id} < ${f.before}` : undefined
			)
		)
		.orderBy(desc(j.id))
		.limit(QUEUE_PAGE + 1)
		.all();
	// One lookup for the related tickets of the whole page (no N+1).
	const ids = [
		...new Set(rows.map((r) => Number(r.ticketId)).filter((x) => Number.isInteger(x) && x > 0))
	];
	const tickets = ids.length
		? new Map(
				getDb()
					.select({
						id: schema.tickets.id,
						number: schema.tickets.number,
						projectId: schema.tickets.projectId
					})
					.from(schema.tickets)
					.where(inArray(schema.tickets.id, ids))
					.all()
					.map((t) => [t.id, t])
			)
		: new Map();
	return {
		jobs: rows.slice(0, QUEUE_PAGE).map(({ ticketId, summary, lastError, ...r }) => {
			const t = tickets.get(Number(ticketId));
			return {
				...r,
				// Only a ticket of the job's own project is linked.
				ticketNumber: t && t.projectId === r.projectId ? t.number : null,
				summary: summary ? redact(String(summary), 120) : null,
				lastError: lastError ? redact(lastError, 300) : null
			};
		}),
		more: rows.length > QUEUE_PAGE
	};
}
export type QueueJobRow = ReturnType<typeof listQueueJobs>['jobs'][number];

/** Retry now: failed jobs start over, waiting retries run immediately. */
export function retryNow(actorId: number, id: number, ip: string | null, projectId?: number) {
	const job = getDb().select().from(j).where(eq(j.id, id)).get();
	if (!job || (projectId !== undefined && job.projectId !== projectId))
		throw new ServiceError('Job not found', 'form');
	if (job.status !== 'dead' && !(job.status === 'pending' && job.lastError))
		throw new ServiceError('Only failed or retrying jobs can be retried', 'form');
	getDb()
		.update(j)
		.set({
			status: 'pending',
			attempts: job.status === 'dead' ? 0 : job.attempts,
			nextAttemptAt: new Date(),
			finishedAt: null,
			updatedAt: new Date()
		})
		.where(eq(j.id, id))
		.run();
	audit({
		actorId,
		action: 'queue.retried',
		targetType: 'job',
		targetId: id,
		data: { kind: job.kind },
		ip
	});
}

/** Permanently removes a failed or waiting job (administrators only). */
export function discardJob(actorId: number, id: number, ip: string | null) {
	const job = getDb().select().from(j).where(eq(j.id, id)).get();
	if (!job || job.status === 'running' || job.status === 'done')
		throw new ServiceError('Only failed or waiting jobs can be discarded', 'form');
	getDb().delete(j).where(eq(j.id, id)).run();
	audit({
		actorId,
		action: 'queue.discarded',
		targetType: 'job',
		targetId: id,
		data: { kind: job.kind, status: job.status },
		ip
	});
}

/** Details for the job dialog: metadata only (never the payload). */
export function jobDetails(id: number, projectId?: number) {
	const row = getDb()
		.select({
			id: j.id,
			kind: j.kind,
			status: j.status,
			attempts: j.attempts,
			maxAttempts: j.maxAttempts,
			lastError: j.lastError,
			nextAttemptAt: j.nextAttemptAt,
			createdAt: j.createdAt,
			updatedAt: j.updatedAt,
			finishedAt: j.finishedAt,
			projectId: j.projectId,
			hookName: schema.projectHooks.name,
			summary: sql<string | null>`json_extract(${j.payload}, '$.summary')`
		})
		.from(j)
		.leftJoin(schema.projectHooks, eq(schema.projectHooks.id, j.hookId))
		.where(eq(j.id, id))
		.get();
	if (!row || (projectId !== undefined && row.projectId !== projectId)) return null;
	return {
		...row,
		summary: row.summary ? redact(String(row.summary), 200) : null,
		lastError: row.lastError ? redact(row.lastError, 300) : null
	};
}

export const isJobKind = (v: string | null): v is JobKind =>
	!!v && (JOB_KINDS as readonly string[]).includes(v);
