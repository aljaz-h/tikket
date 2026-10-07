import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { milestonesApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read', project: 'milestones:read' },
	{},
	({ auth, event }) => {
		const data = milestonesApi(projectAccess(auth, event.params.key!));
		return ok(data, { count: data.length });
	}
);
