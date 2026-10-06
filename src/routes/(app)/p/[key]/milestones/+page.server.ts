import { redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { parseMilestoneForm, requireStaffView } from '$lib/server/planning-forms';
import { createMilestone, listMilestones } from '$lib/server/services/milestones';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireStaffView(requireProject(locals.user, params.key, 'view'));
	return {
		title: `Milestones · ${access.project.name}`,
		milestones: listMilestones(access.project.id),
		canEdit: !access.archived
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const parsed = parseMilestoneForm(await request.formData());
		if (!parsed.ok) return parsed.failure;
		let id: number;
		try {
			id = createMilestone(user, access, parsed.data)!.id;
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, `milestones/${id}`));
	}
};
