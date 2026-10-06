import { redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { clientPermissions, clientProject } from '$lib/server/project-context';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params, url }) => {
	// Canonical lower-case URLs.
	if (params.key !== params.key.toLowerCase())
		redirect(
			301,
			url.pathname.replace(`/p/${params.key}`, `/p/${params.key.toLowerCase()}`) + url.search
		);
	const access = requireProject(locals.user, params.key, 'view');
	return { project: clientProject(access), permissions: clientPermissions(access) };
};
