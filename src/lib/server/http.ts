import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { ServiceError } from './services/users';
import { UploadError } from './uploads';
import type { FieldErrors } from './validation';

type Locals = App.Locals;

/** Returns the signed-in user or redirects to the login page. */
export function requireUser(locals: Locals, url?: URL) {
	if (!locals.user) {
		const next = url ? `?next=${encodeURIComponent(url.pathname + url.search)}` : '';
		redirect(303, `/login${next}`);
	}
	return locals.user;
}

/** For form actions: an unauthenticated POST is a 401, not a redirect. */
export function requireActionUser(locals: Locals) {
	if (!locals.user) error(401, 'Please sign in to continue');
	return locals.user;
}

export function requireAdmin(locals: Locals, url?: URL) {
	const user = requireUser(locals, url);
	if (user.role !== 'admin') error(403, 'Administrator access required');
	return user;
}

/** Converts domain errors into form failures; rethrows anything unexpected. */
export function handleServiceError(err: unknown, values: Record<string, string> = {}) {
	if (err instanceof ServiceError) {
		if (err.status === 404) error(404, err.message);
		return fail(err.status === 403 ? 403 : err.status === 409 ? 409 : 400, {
			errors: { [err.field]: err.message } as FieldErrors,
			values
		});
	}
	if (err instanceof UploadError)
		return fail(400, { errors: { attachments: err.message } as FieldErrors, values });
	throw err;
}

export function safeRedirectTarget(value: string | null | undefined, fallback = '/') {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
		return fallback;
	return value;
}

export function intParam(value: string | undefined | null): number | null {
	if (!value || !/^\d{1,10}$/.test(value)) return null;
	return Number(value);
}

export function isSecure(event: Pick<RequestEvent, 'url'>) {
	return event.url.protocol === 'https:';
}
