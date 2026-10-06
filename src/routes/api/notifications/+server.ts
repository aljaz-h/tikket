import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { listNotifications, markAllRead, markRead } from '$lib/server/services/notifications';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Please sign in');
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
	return json({ items: listNotifications(locals.user.id, { limit }) });
};

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.number().int().positive()).max(200) })]);

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Please sign in');
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request');
	const changed = 'all' in parsed.data ? markAllRead(locals.user.id) : markRead(locals.user.id, parsed.data.ids);
	return json({ changed });
};
