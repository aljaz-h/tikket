import { apiHandler, ok, pageParams, projectAccess, readJson } from '$lib/server/api/http';
import { createCommentApi, listCommentsApi, requireTicket } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'comments:read', project: 'tickets:read' },
	{},
	({ auth, event }) => {
		const access = projectAccess(auth, event.params.key!);
		const result = listCommentsApi(
			access,
			requireTicket(access, event.params.number!),
			pageParams(event.url)
		);
		return ok(result.data, result.meta);
	}
);

export const POST: RequestHandler = apiHandler(
	{ personal: 'comments:write', project: 'comments:create' },
	{ write: true },
	async (ctx) => {
		const access = projectAccess(ctx.auth, ctx.event.params.key!);
		const ticket = requireTicket(access, ctx.event.params.number!);
		return ok(createCommentApi(ctx, access, ticket, await readJson(ctx.event)), {}, 201);
	}
);
