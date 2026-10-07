import { apiHandler, ok, projectAccess } from '$lib/server/api/http';
import { serializeProject } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read', project: 'any' },
	{},
	({ auth, event }) => {
		const access = projectAccess(auth, event.params.key!);
		return ok(serializeProject(access.project, access));
	}
);
