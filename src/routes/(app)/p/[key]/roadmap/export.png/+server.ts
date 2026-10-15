import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { prepareRoadmapImage } from '$lib/server/roadmap-image';
import { pngResponse } from '$lib/server/roadmap-image/response';
import { canViewRoadmap, roadmapSettings } from '$lib/server/services/roadmap';
import type { RequestHandler } from './$types';

/**
 * Roadmap as a PNG for people who can open the roadmap page – exactly the same visibility rule
 * (staff-only and members-only roadmaps need a session; public ones also work signed out).
 * Staff exports include the Open / Unplanned column; staff-only details never appear.
 */
export const GET: RequestHandler = async ({ locals, params, request, url }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const settings = roadmapSettings(access.project);
	// Same answer as for a roadmap that doesn't exist.
	if (!canViewRoadmap(access, settings)) error(404, 'Not found');
	const image = prepareRoadmapImage(access.project, settings, access.isStaff || settings.showOpen);
	return pngResponse(request, image, {
		cacheControl: 'private, no-cache',
		filename: `${access.project.key.toLowerCase()}-roadmap.png`,
		download: url.searchParams.has('download')
	});
};
