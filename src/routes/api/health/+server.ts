import { json } from '@sveltejs/kit';
import { getInstance } from '$lib/server/db';
import { isReady } from '$lib/server/startup';
import type { RequestHandler } from './$types';

/** Liveness/readiness probe used by Docker and reverse proxies. */
export const GET: RequestHandler = async () => {
	if (!isReady())
		return json({ status: 'starting' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	try {
		getInstance().sqlite.prepare('select 1').get();
		return json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return json({ status: 'error' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
};
