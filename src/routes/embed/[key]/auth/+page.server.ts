import { error, fail } from '@sveltejs/kit';
import { attemptLogin } from '$lib/server/auth/login';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { accessForProject } from '$lib/server/authz';
import {
	createWidgetToken,
	findWidget,
	isOriginAllowed,
	WIDGET_TOKEN_TTL_MS
} from '$lib/server/services/widget';
import { ServiceError } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { loginSchema, parseForm } from '$lib/server/validation';
import { normalizeOrigin } from '$lib/shared/widget';
import type { Actions, PageServerLoad } from './$types';

/**
 * First-party sign-in popup for the widget. Runs as a top-level Tikket page (normal session
 * cookies, CSRF protection, never frameable). After an explicit "Allow", it issues a short-lived
 * token that only this project's widget, on the named website, can use.
 */
function context(key: string, url: URL) {
	const widget = findWidget(key);
	if (!widget) error(404, 'This feedback widget is not available');
	const raw = url.searchParams.get('host') ?? '';
	const host = normalizeOrigin(raw);
	if (!host || host !== raw || (host !== url.origin && !isOriginAllowed(widget.project.id, host)))
		error(400, 'This website is not allowed to use the Tikket widget');
	return { widget, host };
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { widget, host } = context(params.key, url);
	const user = locals.user;
	return {
		title: 'Sign in to send feedback',
		projectName: widget.project.name,
		host,
		signedInAs: user ? user.displayName : null,
		canSubmit: user ? accessForProject(user, widget.project).canSubmit : false,
		registrationEnabled: getSettings().registrationEnabled,
		hours: Math.round(WIDGET_TOKEN_TTL_MS / 3_600_000)
	};
};

export const actions: Actions = {
	login: async (event) => {
		context(event.params.key, event.url);
		const parsed = parseForm(loginSchema, await event.request.formData());
		if (!parsed.ok) return parsed.failure;
		const failure = await attemptLogin(event, parsed.data.identifier, parsed.data.password);
		if (failure)
			return fail(failure.status, {
				errors: { form: failure.message },
				values: { identifier: parsed.data.identifier }
			});
		return { signedIn: true };
	},
	authorize: async ({ params, url, locals }) => {
		const { widget, host } = context(params.key, url);
		if (!locals.user) return fail(401, { errors: { form: 'Please sign in first.' }, values: {} });
		const wait = limiters.widgetAuth.hit(`widget-auth:${locals.user.id}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		try {
			const { token, expiresAt } = createWidgetToken(locals.user, widget.project, host);
			return { token, expiresAt: expiresAt.toISOString(), displayName: locals.user.displayName };
		} catch (err) {
			if (err instanceof ServiceError)
				return fail(err.status, { errors: { form: err.message }, values: {} });
			throw err;
		}
	}
};
