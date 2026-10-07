import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { releasesApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read', project: 'releases:read' },
	{},
	({ auth, event }) => {
		const data = releasesApi(projectAccess(auth, event.params.key!));
		return ok(data, { count: data.length });
	}
);
