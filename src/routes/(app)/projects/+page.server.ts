import { listProjects } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const showArchived = url.searchParams.get('archived') === '1';
	return {
		title: 'Projects',
		showArchived,
		projects: listProjects(locals.user, { archived: showArchived })
	};
};
