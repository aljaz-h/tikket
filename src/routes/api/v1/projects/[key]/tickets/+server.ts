import { apiHandler, json, ok, pageParams, projectAccess, readJson } from '$lib/server/api/http';
import { createTicketApi, listTicketsApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'tickets:read', project: 'tickets:read' },
	{},
	({ auth, event }) => {
		const access = projectAccess(auth, event.params.key!);
		const result = listTicketsApi(access, event.url, pageParams(event.url));
		return ok(result.data, result.meta);
	}
);

export const POST: RequestHandler = apiHandler(
	{ personal: 'tickets:write', project: 'tickets:create' },
	{ write: true },
	async (ctx) => {
		const access = projectAccess(ctx.auth, ctx.event.params.key!);
		const body = await readJson(ctx.event);
		const result = createTicketApi(ctx, access, body);
		return json(result.body, result.status, ctx.headers);
	}
);
