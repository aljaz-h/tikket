import { fail } from '@sveltejs/kit';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { invalidateUserSessions } from '$lib/server/auth/session';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { changePassword, deleteUserSession, listUserSessions } from '$lib/server/services/users';
import { changePasswordSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const sessions = listUserSessions(locals.user!.id).map((s) => ({
		...s,
		// Never send session identifiers to the browser in full.
		id: s.id.slice(0, 16),
		current: s.id === locals.session?.id
	}));
	return { title: 'Password & sessions', sessions };
};

export const actions: Actions = {
	password: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const wait = limiters.password.hit(`pw:${user.id}`);
		if (wait)
			return fail(429, {
				errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const parsed = parseForm(changePasswordSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			await changePassword(
				user.id,
				parsed.data.currentPassword,
				parsed.data.newPassword,
				locals.session!.id,
				locals.clientIp
			);
		} catch (err) {
			return handleServiceError(err);
		}
		return { passwordChanged: true };
	},
	revoke: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const prefix = String((await request.formData()).get('sessionId') ?? '');
		const match = listUserSessions(user.id).find(
			(s) => s.id.startsWith(prefix) && prefix.length === 16 && s.id !== locals.session?.id
		);
		if (!match) return fail(404, { errors: { form: 'Session not found' }, values: {} });
		deleteUserSession(user.id, match.id);
		return { revoked: true };
	},
	revokeOthers: async ({ locals }) => {
		const user = requireActionUser(locals);
		return { revokedCount: invalidateUserSessions(user.id, locals.session!.id) };
	}
};
