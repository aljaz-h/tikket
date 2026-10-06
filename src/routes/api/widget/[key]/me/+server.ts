import { json } from '@sveltejs/kit';
import { bearerToken, revokeWidgetToken } from '$lib/server/services/widget';
import { NO_STORE, widgetAuth } from '$lib/server/widget-api';
import type { RequestHandler } from './$types';

/** Who is signed in to the widget (validates the bearer token). */
export const GET: RequestHandler = async ({ params, request }) => {
	const { user } = widgetAuth(request, params.key);
	return json({ displayName: user.displayName }, { headers: NO_STORE });
};

/** Signs the widget out by revoking its token. */
export const DELETE: RequestHandler = async ({ request }) => {
	const token = bearerToken(request);
	if (token) revokeWidgetToken(token);
	return new Response(null, { status: 204 });
};
