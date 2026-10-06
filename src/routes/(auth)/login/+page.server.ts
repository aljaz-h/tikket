import { fail, redirect } from '@sveltejs/kit';
import { signIn } from '$lib/server/auth/login';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { isSecure, safeRedirectTarget } from '$lib/server/http';
import { authenticate } from '$lib/server/services/users';
import { loginSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeRedirectTarget(url.searchParams.get('next')));
	return { title: 'Sign in', next: safeRedirectTarget(url.searchParams.get('next'), '') };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, locals, cookies, url } = event;
		const form = await request.formData();
		const parsed = parseForm(loginSchema, form);
		if (!parsed.ok) return parsed.failure;
		const { identifier, password } = parsed.data;
		const accountKey = identifier.toLowerCase();
		const ipKey = locals.clientIp ?? 'unknown';
		const values = { identifier };

		const wait = Math.max(limiters.loginAccount.check(accountKey), limiters.loginIp.check(ipKey));
		if (wait)
			return fail(429, {
				errors: { form: `Too many sign-in attempts. Try again in ${formatWait(wait)}.` },
				values
			});
		limiters.loginIp.hit(ipKey);

		const user = await authenticate(identifier, password);
		if (!user) {
			limiters.loginAccount.hit(accountKey);
			return fail(400, { errors: { form: 'Incorrect username/email or password.' }, values });
		}
		limiters.loginAccount.reset(accountKey);
		signIn(cookies, user.id, {
			ip: locals.clientIp,
			userAgent: request.headers.get('user-agent'),
			secure: isSecure(event)
		});
		redirect(
			303,
			safeRedirectTarget(String(form.get('next') ?? '') || url.searchParams.get('next'))
		);
	}
};
