import { error } from '@sveltejs/kit';
import { accessForProject, findProjectById } from '$lib/server/authz';
import { serveAttachment } from '$lib/server/files';
import { findAttachment } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/**
 * Project logos. A logo is as visible as its project (private projects' logos are not public);
 * an unapplied preview is visible to its uploader only.
 */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	const att = findAttachment(params.id);
	if (!att || att.kind !== 'project_logo' || att.deletedAt || !att.projectId)
		error(404, 'Not found');
	if (!att.attachedAt) {
		if (locals.user?.id !== att.uploaderId) error(404, 'Not found');
	} else {
		const project = findProjectById(att.projectId);
		if (!project || !accessForProject(locals.user, project).canView) error(404, 'Not found');
	}
	// Each logo has its own id, so a replaced logo gets a new URL: long caching is safe.
	return serveAttachment(att, { request, cache: 'private, max-age=604800, immutable' });
};
