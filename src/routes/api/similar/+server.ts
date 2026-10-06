import { json } from '@sveltejs/kit';
import { accessForProject, findProjectByKey } from '$lib/server/authz';
import { similarTickets } from '$lib/server/services/search';
import type { RequestHandler } from './$types';

/** Possible duplicates for a draft ticket title, restricted to projects the user can view. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const key = url.searchParams.get('project') ?? '';
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const project = key ? findProjectByKey(key) : undefined;
	if (!project || q.length < 4 || !accessForProject(locals.user, project).canView)
		return json({ items: [] });
	return json({ items: similarTickets(project.id, q, 5) });
};
