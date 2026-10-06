import { error, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { publishRelease, publishReview } from '$lib/server/services/releases';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	if (!access.isOwner) error(404, 'Not found');
	const id = intParam(params.id);
	const review = id ? publishReview(access.project.id, id) : null;
	if (!review) error(404, 'Release not found');
	if (review.release.status === 'released')
		redirect(303, projectPath(access.project.key, `releases/${id}`));
	return { title: `Publish ${review.release.version}`, ...review, archived: access.archived };
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const id = intParam(params.id);
		if (!id) error(404, 'Release not found');
		const form = await request.formData();
		try {
			publishRelease(user, access, id, { detachUnresolved: form.get('detach') === 'on' });
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, `releases/${id}?published=1`));
	}
};
