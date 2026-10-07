import { requireProject } from '$lib/server/authz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return { title: `Export · Settings · ${access.project.name}` };
};
