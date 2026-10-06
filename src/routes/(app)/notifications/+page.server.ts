import { requireActionUser, requireUser } from '$lib/server/http';
import { listNotifications, markAllRead } from '$lib/server/services/notifications';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, url);
	const unreadOnly = url.searchParams.get('filter') === 'unread';
	return { title: 'Notifications', unreadOnly, items: listNotifications(user.id, { unreadOnly, limit: 100 }) };
};

export const actions: Actions = {
	markAll: async ({ locals }) => {
		const user = requireActionUser(locals);
		return { changed: markAllRead(user.id) };
	}
};
