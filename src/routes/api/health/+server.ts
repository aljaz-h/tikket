import { json } from '@sveltejs/kit';
import { getInstance } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** Liveness/readiness probe used by Docker and reverse proxies. */
export const GET: RequestHandler = async () => {
	try {
		getInstance().sqlite.prepare('select 1').get();
		return json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return json({ status: 'error' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
};
