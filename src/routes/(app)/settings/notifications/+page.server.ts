import { requireActionUser } from '$lib/server/http';
import { getNotificationPrefs, getUser, setNotificationPrefs } from '$lib/server/services/users';
import { NOTIFICATION_TYPES, type NotificationPrefs } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	title: 'Notification settings',
	prefs: getNotificationPrefs(getUser(locals.user!.id)!)
});

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const prefs = Object.fromEntries(
			NOTIFICATION_TYPES.map((t) => [t, form.get(t) === 'on'])
		) as NotificationPrefs;
		setNotificationPrefs(user.id, prefs);
		return { saved: true };
	}
};
