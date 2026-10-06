import { error } from '@sveltejs/kit';
import { discardPending } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/** Removes a pending upload before the ticket or comment is submitted. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Please sign in');
	if (!discardPending(locals.user.id, params.id)) error(404, 'Not found');
	return new Response(null, { status: 204 });
};
