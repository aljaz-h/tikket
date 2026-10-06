import { redirect } from '@sveltejs/kit';
import { listProjects } from '$lib/server/services/projects';
import { managedProjectIds, staffDashboard, userDashboard } from '$lib/server/services/dashboard';
import { listNotifications } from '$lib/server/services/notifications';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	const projects = listProjects(user);
	if (!user) {
		// Anonymous visitors only see projects that allow public read access.
		if (!projects.length) redirect(303, '/login');
		return {
			title: 'Dashboard',
			projects,
			personal: null,
			staff: null,
			notifications: [],
			welcome: false
		};
	}
	const managed = managedProjectIds(user);
	return {
		title: 'Dashboard',
		projects,
		personal: userDashboard(user),
		staff: managed.length ? staffDashboard(user, managed) : null,
		notifications: listNotifications(user.id, { unreadOnly: true, limit: 5 }),
		welcome: url.searchParams.has('welcome')
	};
};
