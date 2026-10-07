import { openApiDocument } from '$lib/server/api/openapi';
import { publicBaseUrl } from '$lib/server/email/notifications';
import type { RequestHandler } from './$types';

/** OpenAPI 3.1 description of /api/v1 (public: it contains no data, only the API's shape). */
export const GET: RequestHandler = () =>
	new Response(JSON.stringify(openApiDocument(publicBaseUrl() || null), null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'public, max-age=300',
			'access-control-allow-origin': '*'
		}
	});
