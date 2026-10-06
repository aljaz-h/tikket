import { requireProject } from '$lib/server/authz';
import { listChangelog } from '$lib/server/services/releases';
import type { PageServerLoad } from './$types';

/** The public changelog: published releases and the completed tickets they shipped. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	return {
		title: `Changelog · ${access.project.name}`,
		entries: listChangelog(access.project.id),
		canManage: access.isStaff
	};
};
