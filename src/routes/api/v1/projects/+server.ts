import { apiHandler, ok } from '$lib/server/api/http';
import { listProjectsApi } from '$lib/server/api/resources';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = apiHandler(
	{ personal: 'projects:read', project: 'any' },
	{},
	({ auth }) => {
		const data = listProjectsApi(auth);
		return ok(data, { count: data.length });
	}
);
