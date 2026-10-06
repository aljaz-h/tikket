import { error } from '@sveltejs/kit';
import { adminActor } from '$lib/server/admin';
import { intParam } from '$lib/server/http';
import { listInvitations, revokeInvitation } from '$lib/server/services/invitations';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminActor(locals);
	return { title: 'Invitations', invitations: listInvitations() };
};

export const actions: Actions = {
	revoke: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const id = intParam(String((await request.formData()).get('invitationId')));
		if (!id || !revokeInvitation(admin.id, id, null, locals.clientIp)) error(404, 'Invitation not found');
		return { revoked: true };
	}
};
