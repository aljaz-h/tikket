import { error } from '@sveltejs/kit';
import { findProjectByKey } from '$lib/server/authz';
import { prepareRoadmapImage } from '$lib/server/roadmap-image';
import { pngResponse } from '$lib/server/roadmap-image/response';
import { publicImageAllowed, roadmapSettings } from '$lib/server/services/roadmap';
import type { RequestHandler } from './$types';

/**
 * Live roadmap image for embedding (README, website, forum). Anonymous by design: it ignores
 * any session and only answers when the owner switched the public image on AND the roadmap is
 * visible to anonymous visitors. Otherwise it is a plain 404, identical for unknown projects, so
 * nothing is revealed and a cached copy can never outlive a visibility change for long.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const project = findProjectByKey(params.key);
	if (!project || !publicImageAllowed(project)) error(404, 'Not found');
	const settings = roadmapSettings(project);
	const image = prepareRoadmapImage(project, settings, settings.showOpen);
	return pngResponse(request, image, {
		// Short lifetime; the ETag makes revalidation cheap. Remote caches such as GitHub's
		// image proxy may still keep a copy longer.
		cacheControl: 'public, max-age=300, must-revalidate',
		filename: `${project.key.toLowerCase()}-roadmap.png`,
		crossOrigin: true
	});
};
