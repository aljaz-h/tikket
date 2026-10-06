import { error } from '@sveltejs/kit';
import { accessForProject, canViewInternalNotes, findProjectById } from '$lib/server/authz';
import { isInternalComment } from '$lib/server/services/comments';
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
		const access = project ? accessForProject(locals.user, project) : undefined;
		if (!access?.canView) error(404, 'Not found');
		// Images attached to internal staff notes are as private as the note itself.
		if (att.commentId && isInternalComment(att.commentId) && !canViewInternalNotes(access))
			error(404, 'Not found');
	}
	return serveAttachment(att, {
		thumb: url.searchParams.has('thumb'),
		download: url.searchParams.has('download'),
		request
	});
};
