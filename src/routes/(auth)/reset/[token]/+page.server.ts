import { fail, redirect } from '@sveltejs/kit';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError } from '$lib/server/http';
import { consumePasswordReset, findValidPasswordReset } from '$lib/server/services/users';
import { parseForm, resetPasswordSchema } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const found = findValidPasswordReset(params.token);
	return { title: 'Reset password', valid: !!found, displayName: found?.user.displayName ?? null };
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		const wait = limiters.signup.hit(`reset:${locals.clientIp}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const parsed = parseForm(resetPasswordSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			await consumePasswordReset(params.token, parsed.data.newPassword, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, '/login?reset=1');
	}
};
