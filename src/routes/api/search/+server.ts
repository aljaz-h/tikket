import { json } from '@sveltejs/kit';
import { globalSearch } from '$lib/server/services/search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	if (q.length < 2) return json({ tickets: [], projects: [] });
	return json(globalSearch(locals.user, q));
};
