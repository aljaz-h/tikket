import { error, fail, redirect } from '@sveltejs/kit';
import { signIn } from '$lib/server/auth/login';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, isSecure } from '$lib/server/http';
import { createUser } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { accountSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	if (!getSettings().registrationEnabled) error(404, 'Registration is disabled');
	return { title: 'Create account' };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, locals, cookies } = event;
		if (!getSettings().registrationEnabled) error(403, 'Registration is disabled');
		const wait = limiters.signup.hit(`register:${locals.clientIp}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const parsed = parseForm(accountSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		let userId: number;
		try {
			// Public sign-ups always receive the normal user role.
			userId = (
				await createUser({ ...parsed.data, role: 'user' }, null, locals.clientIp, 'user.registered')
			).id;
		} catch (err) {
			return handleServiceError(err, {
				username: parsed.data.username,
				email: parsed.data.email,
				displayName: parsed.data.displayName
			});
		}
		signIn(cookies, userId, {
			ip: locals.clientIp,
			userAgent: request.headers.get('user-agent'),
			secure: isSecure(event)
		});
		redirect(303, '/');
	}
};
