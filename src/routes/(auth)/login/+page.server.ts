import { fail, redirect } from '@sveltejs/kit';
import { attemptLogin } from '$lib/server/auth/login';
import { safeRedirectTarget } from '$lib/server/http';
import { loginSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeRedirectTarget(url.searchParams.get('next')));
	return { title: 'Sign in', next: safeRedirectTarget(url.searchParams.get('next'), '') };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, url } = event;
		const form = await request.formData();
		const parsed = parseForm(loginSchema, form);
		if (!parsed.ok) return parsed.failure;
		const { identifier, password } = parsed.data;
		const failure = await attemptLogin(event, identifier, password);
		if (failure)
			return fail(failure.status, { errors: { form: failure.message }, values: { identifier } });
		redirect(
			303,
			safeRedirectTarget(String(form.get('next') ?? '') || url.searchParams.get('next'))
		);
	}
};
