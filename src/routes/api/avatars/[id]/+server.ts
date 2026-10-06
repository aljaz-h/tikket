import { error } from '@sveltejs/kit';
import { serveAttachment } from '$lib/server/files';
import { findAttachment } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, request }) => {
	const att = findAttachment(params.id);
	if (!att || att.kind !== 'avatar' || att.deletedAt) error(404, 'Not found');
	return serveAttachment(att, { thumb: true, request, cache: 'public, max-age=604800, immutable' });
};
