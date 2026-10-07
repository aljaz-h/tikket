import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { labelsApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read', project: 'tickets:read' },
	{},
	({ auth, event }) => {
		const data = labelsApi(projectAccess(auth, event.params.key!));
		return ok(data, { count: data.length });
	}
);
