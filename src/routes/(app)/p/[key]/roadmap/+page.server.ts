import { requireProject } from '$lib/server/authz';
import { roadmap } from '$lib/server/services/dashboard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	return { title: `Roadmap · ${access.project.name}`, roadmap: roadmap(access.project.id) };
};
