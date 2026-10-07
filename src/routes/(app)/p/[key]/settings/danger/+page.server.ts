import { requireProject } from '$lib/server/authz';
import { requireActionUser } from '$lib/server/http';
import { setArchived } from '$lib/server/services/projects';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return { title: `Danger zone · Settings · ${access.project.name}` };
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

export const actions: Actions = {
	archive: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		setArchived(user.id, access.project, true, locals.clientIp);
		return { archived: true };
	},

	unarchive: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		setArchived(user.id, access.project, false, locals.clientIp);
		return { archived: false };
	}
};
