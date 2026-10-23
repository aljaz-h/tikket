import { redirect } from '@sveltejs/kit';
import { authenticateToken } from '$lib/server/api/tokens';
import { openApiDocument } from '$lib/server/api/openapi';
import { publicBaseUrl } from '$lib/server/email/notifications';
import type { RequestHandler } from './$types';

/**
 * OpenAPI 3.1 description of /api/v1. Like the API documentation page it is only for people with
 * an account: a signed-in session, or a valid API token (so tools can import it with
 * `Authorization: Bearer …`).
 */
export const GET: RequestHandler = ({ locals, request, url }) => {
	const signedIn =
		!!locals.user || typeof authenticateToken(request.headers.get('authorization')) !== 'string';
	if (!signedIn) {
		// Browsers go to the login page; tools get a plain 401.
		if (request.headers.get('accept')?.includes('text/html'))
			redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		return new Response(
			JSON.stringify({
				error: {
					code: 'unauthenticated',
					message: 'Sign in or send an API token to read the API description'
				}
			}),
			{
				status: 401,
				headers: {
					'content-type': 'application/json; charset=utf-8',
					'www-authenticate': 'Bearer realm="tikket"',
					'cache-control': 'no-store'
				}
			}
		);
	}
	return new Response(JSON.stringify(openApiDocument(publicBaseUrl() || null), null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store'
		}
	});
};
