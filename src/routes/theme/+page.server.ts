import { redirect } from '@sveltejs/kit';
import { setTheme } from '$lib/server/services/users';
import { safeRedirectTarget, isSecure } from '$lib/server/http';
import { THEME_COOKIE, THEMES, type Theme } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => redirect(303, '/');

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const theme = String(form.get('theme')) as Theme;
		if (THEMES.includes(theme)) {
			event.cookies.set(THEME_COOKIE, theme, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecure(event),
				maxAge: 60 * 60 * 24 * 365
			});
			if (event.locals.user) setTheme(event.locals.user.id, theme);
		}
		redirect(303, safeRedirectTarget(String(form.get('redirectTo') ?? '/')));
	}
};
