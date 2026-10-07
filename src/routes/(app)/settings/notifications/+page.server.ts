import { emailEnabled } from '$lib/server/email/config';
import { getEmailPrefs, setEmailPrefs } from '$lib/server/email/notifications';
import { requireActionUser } from '$lib/server/http';
import { getNotificationPrefs, getUser, setNotificationPrefs } from '$lib/server/services/users';
import { NOTIFICATION_TYPES, type NotificationPrefs } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = getUser(locals.user!.id)!;
	return {
		title: 'Notification settings',
		prefs: getNotificationPrefs(user),
		emailPrefs: getEmailPrefs(user),
		emailEnabled: emailEnabled(),
		email: user.email
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const read = (prefix: string) =>
			Object.fromEntries(
				NOTIFICATION_TYPES.map((t) => [t, form.get(`${prefix}${t}`) === 'on'])
			) as NotificationPrefs;
		setNotificationPrefs(user.id, read(''));
		// Email choices are only on the form when email is available; keep them otherwise.
		if (form.get('emailForm') === '1') setEmailPrefs(user.id, read('email:'));
		return { saved: true };
	}
};
