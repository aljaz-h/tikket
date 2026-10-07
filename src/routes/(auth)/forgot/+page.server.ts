import { error, fail, redirect } from '@sveltejs/kit';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { requestPasswordResetEmail } from '$lib/server/email/account';
import { emailEnabled } from '$lib/server/email/config';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/settings/security');
	if (!emailEnabled()) error(404, 'Not found');
	return { title: 'Forgot password' };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!emailEnabled()) error(404, 'Not found');
		const wait = limiters.passwordResetIp.hit(`ip:${locals.clientIp ?? 'unknown'}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many requests. Try again in ${formatWait(wait)}.` }
			});
		const identifier = String((await request.formData()).get('identifier') ?? '').slice(0, 254);
		if (!identifier.trim())
			return fail(400, { errors: { identifier: 'Enter your username or email' } });
		// Same answer whether or not the account exists (no account enumeration).
		requestPasswordResetEmail(identifier);
		return { sent: true };
	}
};
