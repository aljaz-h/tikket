/**
 * Registers every outbound job handler. Import this module (not the handlers individually)
 * wherever the queue must be able to run jobs: the server start-up and tests.
 */
import { lt } from 'drizzle-orm';
import { getDb, schema } from '../db';
import '../email/notifications';
import '../integrations/delivery';
import '../automations/engine';
import { pruneJobs } from './queue';

export { drainQueue, startWorker, stopWorker, workerEnabled } from './queue';

/** Hourly maintenance: old jobs and old GitHub delivery ids. */
export function pruneOutbound() {
	const jobs = pruneJobs();
	getDb()
		.delete(schema.githubDeliveries)
		.where(lt(schema.githubDeliveries.receivedAt, new Date(Date.now() - 30 * 864e5)))
		.run();
	return jobs;
}
