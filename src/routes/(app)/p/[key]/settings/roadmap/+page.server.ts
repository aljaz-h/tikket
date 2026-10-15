import { fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { getSettings } from '$lib/server/settings';
import {
	canViewRoadmap,
	publicImageAllowed,
	roadmapSettings,
	saveRoadmapSettings
} from '$lib/server/services/roadmap';
import { accessForProject } from '$lib/server/authz';
import {
	ROADMAP_AUDIENCES,
	ROADMAP_IMAGE_LAYOUTS,
	type RoadmapAudience,
	type RoadmapImageLayout
} from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Roadmap visibility · Settings · ${access.project.name}`,
		settings: roadmapSettings(access.project),
		votingEnabled: access.project.votingEnabled,
		baseUrl: (getSettings().appUrl || url.origin).replace(/\/$/, ''),
		projectIsPublic: canViewRoadmap(accessForProject(null, access.project), {
			...roadmapSettings(access.project),
			audience: 'viewers'
		}),
		imageLive: publicImageAllowed(access.project)
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
		const layout = String(form.get('imageLayout') ?? 'full');
		try {
			saveRoadmapSettings(
				user.id,
				access,
				{
					audience: audience as RoadmapAudience,
					showOpen: on('showOpen'),
					image: {
						public: on('imagePublic'),
						layout: (ROADMAP_IMAGE_LAYOUTS.includes(layout as RoadmapImageLayout)
							? layout
							: 'full') as RoadmapImageLayout,
						showLogo: on('imageShowLogo'),
						showTimestamp: on('imageShowTimestamp')
					},
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
