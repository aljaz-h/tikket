import { redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { parseReleaseForm, requireStaffView } from '$lib/server/planning-forms';
import { createRelease, listReleases } from '$lib/server/services/releases';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireStaffView(requireProject(locals.user, params.key, 'view'));
	return {
		title: `Releases · ${access.project.name}`,
		releases: listReleases(access.project.id),
		canEdit: !access.archived
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const parsed = parseReleaseForm(await request.formData());
		if (!parsed.ok) return parsed.failure;
		let id: number;
		try {
			id = createRelease(user, access, parsed.data)!.id;
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, `releases/${id}`));
	}
};
