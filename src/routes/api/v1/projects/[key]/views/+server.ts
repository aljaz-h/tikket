import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { viewsApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

/** Shared views and the token owner's personal views (personal tokens only). */
export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read' },
	{},
	({ auth, event }) => {
		const data = viewsApi(auth, projectAccess(auth, event.params.key!));
		return ok(data, { count: data.length });
	}
);
