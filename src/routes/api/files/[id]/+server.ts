import { error } from '@sveltejs/kit';
import { accessForProject, findProjectById } from '$lib/server/authz';
import { serveAttachment } from '$lib/server/files';
import { findAttachment } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/**
 * Authorisation-aware attachment download. Files never live in a public static directory;
 * every request is checked against the attachment's project.
 */
export const GET: RequestHandler = async ({ params, locals, url, request }) => {
	const att = findAttachment(params.id);
	if (!att || att.deletedAt || att.kind === 'avatar') error(404, 'Not found');
	if (!att.attachedAt) {
		// Pending uploads are visible to their uploader only.
		if (!locals.user || locals.user.id !== att.uploaderId) error(404, 'Not found');
	} else {
		const project = att.projectId ? findProjectById(att.projectId) : undefined;
		if (!project || !accessForProject(locals.user, project).canView) error(404, 'Not found');
	}
	return serveAttachment(att, {
		thumb: url.searchParams.has('thumb'),
		download: url.searchParams.has('download'),
		request
	});
};
