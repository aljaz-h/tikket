import { fail, redirect } from '@sveltejs/kit';
import { signIn } from '$lib/server/auth/login';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, isSecure } from '$lib/server/http';
import {
	acceptInvitationAsExistingUser,
	acceptInvitationAsNewUser,
	findValidInvitation
} from '$lib/server/services/invitations';
import { projectPath } from '$lib/shared/format';
import { accountSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const found = findValidInvitation(params.token);
	if (!found) return { title: 'Invitation', valid: false as const };
	const inv = found.invitation;
	return {
		title: 'Invitation',
		valid: true as const,
		email: inv.email,
		role: inv.role,
		projectName: found.projectName,
		projectKey: found.projectKey,
		projectRole: inv.projectRole,
		inviterName: found.inviterName,
		signedInAs: locals.user ? { displayName: locals.user.displayName, email: locals.user.email } : null
	};
};

export const actions: Actions = {
	register: async (event) => {
		const { request, locals, cookies, params } = event;
		const wait = limiters.signup.hit(`invite:${locals.clientIp}`);
		if (wait) return fail(429, { errors: { form: `Too many attempts. Try again in ${formatWait(wait)}.` }, values: {} });
		const parsed = parseForm(accountSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		const target = findValidInvitation(params.token)?.projectKey;
		let userId: number;
		try {
			userId = (await acceptInvitationAsNewUser(params.token, parsed.data, locals.clientIp)).id;
		} catch (err) {
			return handleServiceError(err, { username: parsed.data.username, email: parsed.data.email, displayName: parsed.data.displayName });
		}
		signIn(cookies, userId, { ip: locals.clientIp, userAgent: request.headers.get('user-agent'), secure: isSecure(event) });
		redirect(303, target ? projectPath(target) : '/');
	},
	accept: async ({ locals, params }) => {
		if (!locals.user) redirect(303, `/login?next=/invite/${params.token}`);
		const found = findValidInvitation(params.token);
		try {
			acceptInvitationAsExistingUser(params.token, locals.user, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, found?.projectKey ? projectPath(found.projectKey) : '/');
	}
};
