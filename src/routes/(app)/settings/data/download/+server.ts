import { error } from '@sveltejs/kit';
import { personalCsv, personalExport } from '$lib/server/services/export';
import type { RequestHandler } from './$types';

/** A user's own submissions and comments (projects they can still view). */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Please sign in to continue');
	const data = personalExport(locals.user);
	const date = new Date().toISOString().slice(0, 10);
	const csv = url.searchParams.get('format') === 'csv';
	const body = csv
		? personalCsv(data.tickets)
		: JSON.stringify(
				{
					format: 'tikket-personal',
					version: 1,
					exported_at: new Date().toISOString(),
					user: { username: locals.user.username, name: locals.user.displayName },
					...data
				},
				null,
				2
			);
	return new Response(body, {
		headers: {
			'content-type': csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="tikket-${locals.user.username}-${date}.${csv ? 'csv' : 'json'}"`,
			'cache-control': 'private, no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
