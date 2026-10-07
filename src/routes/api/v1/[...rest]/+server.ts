import { json } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** Unknown API paths answer with the API error shape, not the HTML error page. */
const notFound: RequestHandler = () =>
	json(
		{ error: { code: 'not_found', message: 'Unknown API endpoint. See /api/openapi.json' } },
		404
	);
export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
