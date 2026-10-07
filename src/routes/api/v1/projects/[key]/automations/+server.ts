import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { automationsApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read' },
	{},
	({ auth, event }) => {
		const data = automationsApi(projectAccess(auth, event.params.key!));
		return ok(data, { count: data.length });
	}
);
