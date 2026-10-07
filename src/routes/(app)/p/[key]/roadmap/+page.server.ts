import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { canViewRoadmap, roadmapFor, roadmapSettings } from '$lib/server/services/roadmap';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const settings = roadmapSettings(access.project);
	// Same answer as for a page that doesn't exist: the roadmap's existence isn't revealed.
	if (!canViewRoadmap(access, settings)) error(404, 'Not found');
	return {
		title: `Roadmap · ${access.project.name}`,
		roadmap: roadmapFor(access.project, settings, access.isStaff),
		audience: settings.audience
	};
};
