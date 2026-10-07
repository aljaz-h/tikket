import { fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { roadmapSettings, saveRoadmapSettings } from '$lib/server/services/roadmap';
import { ROADMAP_AUDIENCES, type RoadmapAudience } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Roadmap visibility · Settings · ${access.project.name}`,
		settings: roadmapSettings(access.project),
		votingEnabled: access.project.votingEnabled
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const form = await request.formData();
		const audience = String(form.get('audience') ?? '');
		if (!ROADMAP_AUDIENCES.includes(audience as RoadmapAudience))
			return fail(400, { errors: { audience: 'Choose who can see the roadmap' } });
		const on = (name: string) => form.get(name) === 'on';
		try {
			saveRoadmapSettings(
				user.id,
				access,
				{
					audience: audience as RoadmapAudience,
					showReleases: on('showReleases'),
					showReleaseDates: on('showReleaseDates'),
					showMilestones: on('showMilestones'),
					showPriorities: on('showPriorities'),
					showVotes: on('showVotes'),
					showAssignees: on('showAssignees')
				},
				locals.clientIp
			);
		} catch (err) {
			return handleServiceError(err);
		}
		return { saved: true };
	}
};
