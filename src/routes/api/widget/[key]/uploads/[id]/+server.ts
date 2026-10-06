import { error } from '@sveltejs/kit';
import { discardPending } from '$lib/server/uploads';
import { widgetAuth } from '$lib/server/widget-api';
import type { RequestHandler } from './$types';

/** Removes one of the user's pending widget uploads before submitting. */
export const DELETE: RequestHandler = async ({ params, request }) => {
	const { user } = widgetAuth(request, params.key);
	if (!discardPending(user.id, params.id)) error(404, 'Not found');
	return new Response(null, { status: 204 });
};
