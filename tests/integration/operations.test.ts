import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshDb, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { User } from '../../src/lib/server/db/schema';
import {
	enqueue,
	registerHandler,
	DeliveryError,
	drainQueue
} from '../../src/lib/server/outbound/queue';
import {
	discardJob,
	jobDetails,
	listQueueJobs,
	queueOverview,
	retryNow
} from '../../src/lib/server/outbound/admin';
import { healthReport } from '../../src/lib/server/ops';
import { redact } from '../../src/lib/server/redact';

let admin: User;
let failWith: DeliveryError | null = null;
let delivered = 0;

registerHandler('discord', async () => {
	if (failWith) throw failWith;
	delivered++;
});

beforeEach(async () => {
	freshDb();
	admin = await makeUser('admin');
	failWith = null;
	delivered = 0;
});

const secretUrl = 'https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwxyzABCDEFGH';

describe('delivery queue visibility', () => {
	it('shows waiting, retrying and failed jobs with redacted errors', async () => {
		const p = makeProject(admin, { key: 'OPS' });
		enqueue({
			kind: 'discord',
			payload: { summary: 'ticket.created evt_1', ticketId: 1 },
			projectId: p.id
		});
		expect(queueOverview()).toMatchObject({ pending: 1, retrying: 0, failed: 0 });

		failWith = new DeliveryError(`POST ${secretUrl} failed: 500`, true);
		await drainQueue(1);
		const retrying = listQueueJobs({ filter: 'retrying' }).jobs;
		expect(retrying).toHaveLength(1);
		expect(retrying[0].lastError).toBe('POST [url] failed: 500');
		expect(JSON.stringify(retrying)).not.toContain('abcdefghijklmnop');
		expect(retrying[0]).toMatchObject({ kind: 'discord', projectKey: 'OPS' });
		expect(queueOverview()).toMatchObject({ retrying: 1 });

		// Retry now runs a waiting retry immediately; a permanent error makes it fail.
		failWith = new DeliveryError('Webhook was deleted (404)', false);
		retryNow(admin.id, retrying[0].id, null);
		await drainQueue(1);
		const failed = listQueueJobs({ filter: 'failed' }).jobs;
		expect(failed).toHaveLength(1);
		expect(queueOverview()).toMatchObject({ failed: 1, retrying: 0 });
		const details = jobDetails(failed[0].id)!;
		expect(details.lastError).toMatch(/404/);
		expect(JSON.stringify(details)).not.toContain('payload');

		// A failed job starts over with fresh attempts.
		failWith = null;
		retryNow(admin.id, failed[0].id, null);
		await drainQueue(1);
		expect(delivered).toBe(1);
		expect(queueOverview()).toMatchObject({ failed: 0, doneRecently: 1 });
		const audits = getDb()
			.select()
			.from(schema.auditLogs)
			.where(eq(schema.auditLogs.action, 'queue.retried'))
			.all();
		expect(audits).toHaveLength(2);
	});

	it('discards failed jobs, never delivered ones; project scoping for owners', async () => {
		const p = makeProject(admin, { key: 'ONE' });
		const q = makeProject(admin, { key: 'TWO' });
		enqueue({ kind: 'discord', payload: { summary: 'x' }, projectId: p.id, maxAttempts: 1 });
		failWith = new DeliveryError('nope', false);
		await drainQueue(1);
		const [job] = listQueueJobs({ filter: 'failed' }).jobs;
		expect(() => retryNow(admin.id, job.id, null, q.id)).toThrow(/not found/);
		expect(jobDetails(job.id, q.id)).toBeNull();
		discardJob(admin.id, job.id, null);
		expect(listQueueJobs({ filter: 'failed' }).jobs).toHaveLength(0);
		enqueue({ kind: 'discord', payload: { summary: 'ok' }, projectId: p.id });
		failWith = null;
		await drainQueue(1);
		const done = getDb().select().from(schema.outboundJobs).get()!;
		expect(() => discardJob(admin.id, done.id, null)).toThrow(/Only failed or waiting/);
	});

	it('redacts tokens, URLs, bearer credentials, long secrets and stack traces', () => {
		expect(redact('Bearer abc.def failed\n  at x (y.ts:1)')).toBe('Bearer [secret] failed');
		expect(redact('ghp_1234567890abcdef token tkt_prj_xyz')).toBe('[secret] token [secret]');
		expect(redact('key=QWERTYUIOPASDFGHJKLZXCVBNM1234567890qw')).toBe('key=[redacted]');
		expect(redact('smtp://user:pass@mail.example.com:587 refused')).toBe('[url] refused');
	});
});

describe('health report', () => {
	it('reports database, storage, queue and warnings without paths or secrets', () => {
		const h = healthReport();
		expect(h.db).toMatchObject({ connected: true, foreignKeys: true });
		expect(h.db.migrations).toBe(h.db.expectedMigrations);
		expect(h.storage.dataWritable).toBe(true);
		expect(h.warnings.map((w) => w.message)).toEqual(
			expect.arrayContaining([expect.stringMatching(/No backup has been recorded/)])
		);
		const json = JSON.stringify(h);
		expect(json).not.toContain(process.env.UPLOADS_DIR!);
		expect(json).not.toMatch(/tikket-db-/);
	});
});
