import { globalSearch } from '$lib/server/services/search';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	return {
		title: q ? `Search: ${q}` : 'Search',
		q,
		results: q.length >= 2 ? globalSearch(locals.user, q, 50) : null
	};
};
