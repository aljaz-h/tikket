import { redirect } from '@sveltejs/kit';
import { clearSessionCookie, invalidateSession } from '$lib/server/auth/session';
import { isSecure } from '$lib/server/http';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => redirect(303, '/');

export const actions: Actions = {
	default: async (event) => {
		if (event.locals.session) invalidateSession(event.locals.session.id);
		clearSessionCookie(event.cookies, isSecure(event));
		redirect(303, '/login');
	}
};
