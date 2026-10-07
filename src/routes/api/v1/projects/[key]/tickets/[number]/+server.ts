import { apiHandler, ok, projectAccess, readJson } from '$lib/server/api/http';
import { patchTicketApi, requireTicket, ticketApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'tickets:read', project: 'tickets:read' },
	{},
	({ auth, event }) => {
		const access = projectAccess(auth, event.params.key!);
		return ok(ticketApi(access, requireTicket(access, event.params.number!)));
	}
);

export const PATCH: RequestHandler = apiHandler(
	{ personal: 'tickets:write', project: 'tickets:update' },
	{ write: true },
	async (ctx) => {
		const access = projectAccess(ctx.auth, ctx.event.params.key!);
		const ticket = requireTicket(access, ctx.event.params.number!);
		return ok(patchTicketApi(ctx, access, ticket, await readJson(ctx.event)));
	}
);
