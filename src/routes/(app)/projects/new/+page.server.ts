import { error, redirect } from '@sveltejs/kit';
import { canCreateProjects } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser, requireUser } from '$lib/server/http';
import { createProject } from '$lib/server/services/projects';
import { listUsers } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { parseForm, projectSchema } from '$lib/server/validation';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, url);
	if (!canCreateProjects(user, getSettings().allowUserProjectCreation)) error(403, 'You cannot create projects');
	return {
		title: 'New project',
		owners: user.role === 'admin' ? listUsers({ page: 1, pageSize: 500 }).rows.filter((u) => u.status === 'active') : []
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		if (!canCreateProjects(user, getSettings().allowUserProjectCreation)) error(403, 'You cannot create projects');
		const form = await request.formData();
		const parsed = parseForm(projectSchema, form);
		if (!parsed.ok) return parsed.failure;
		// Only administrators may make someone else the owner.
		const requestedOwner = intParam(String(form.get('ownerId') ?? ''));
		const ownerId = user.role === 'admin' && requestedOwner ? requestedOwner : user.id;
		let key: string;
		try {
			key = createProject(user.id, parsed.data, ownerId, locals.clientIp).key;
		} catch (err) {
			return handleServiceError(err, Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
		}
		redirect(303, projectPath(key));
	}
};
