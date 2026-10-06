import { fail, redirect } from '@sveltejs/kit';
import { signIn } from '$lib/server/auth/login';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, isSecure } from '$lib/server/http';
import { needsSetup, setupFirstAdmin } from '$lib/server/services/users';
import { updateSettings } from '$lib/server/settings';
import { accountSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (!needsSetup()) redirect(303, '/');
	return { title: 'Welcome' };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, locals, cookies } = event;
		if (!needsSetup()) redirect(303, '/login');
		const wait = limiters.signup.hit(`setup:${locals.clientIp}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const form = await request.formData();
		const parsed = parseForm(accountSchema, form);
		if (!parsed.ok) return parsed.failure;
		const appName = String(form.get('appName') ?? '').trim();
		let userId: number;
		try {
			const user = await setupFirstAdmin(parsed.data, locals.clientIp);
			userId = user.id;
		} catch (err) {
			return handleServiceError(err, { ...parsed.data, password: '', confirmPassword: '' });
		}
		if (appName) updateSettings({ appName: appName.slice(0, 60) });
		signIn(cookies, userId, {
			ip: locals.clientIp,
			userAgent: request.headers.get('user-agent'),
			secure: isSecure(event)
		});
		redirect(303, '/?welcome=1');
	}
};
