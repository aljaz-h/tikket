import { json } from '@sveltejs/kit';
import { handleGithubWebhook } from '$lib/server/integrations/github';
import type { RequestHandler } from './$types';

const MAX_BODY = 5 * 1024 * 1024;

/**
 * GitHub repository webhook. Authenticated by the HMAC signature (not by session or origin),
 * so it is exempt from the same-origin check for /api in hooks.server.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_BODY) return json({ message: 'Payload too large' }, { status: 413 });
	if (!/application\/json/i.test(request.headers.get('content-type') ?? ''))
		return json({ message: 'Use content type application/json' }, { status: 415 });
	const body = Buffer.from(await request.arrayBuffer());
	if (body.length > MAX_BODY) return json({ message: 'Payload too large' }, { status: 413 });
	const result = await handleGithubWebhook(
		params.id,
		{
			event: request.headers.get('x-github-event'),
			delivery: request.headers.get('x-github-delivery'),
			signature: request.headers.get('x-hub-signature-256')
		},
		body
	);
	return json({ message: result.message }, { status: result.status });
};
