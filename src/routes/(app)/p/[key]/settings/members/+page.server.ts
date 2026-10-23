import { error, fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import {
	createInvitation,
	listInvitations,
	revokeInvitation
} from '$lib/server/services/invitations';
import {
	addableUsers,
	addMember,
	changeMemberRole,
	listMembers,
	removeMember
} from '$lib/server/services/projects';
import { findUserByIdentifier } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { email as emailSchema, projectRoleSchema } from '$lib/server/validation';
import { sendInvitationEmail } from '$lib/server/email/account';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Members · Settings · ${access.project.name}`,
		members: listMembers(access.project.id),
		addable: addableUsers(access.project.id),
		invitations: listInvitations(access.project.id).filter(
			(i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date()
		),
		invitationLifetimeDays: getSettings().invitationLifetimeDays
	};
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

export const actions: Actions = {
	addMember: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim();
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!identifier || !role.success)
			return fail(400, {
				errors: { member: 'Enter a username or email and a role' },
				values: { identifier }
			});
		const target = findUserByIdentifier(identifier);
		if (!target || target.status !== 'active')
			return fail(400, {
				errors: {
					member: 'No active user with that username or email. Send an invitation instead.'
				},
				values: { identifier }
			});
		try {
			addMember(user.id, access.project, target.id, role.data, locals.clientIp);
		} catch (err) {
			return handleServiceError(err, { identifier });
		}
		return { memberAdded: target.displayName };
	},

	/** Adds the people ticked in the picker, all with the chosen role. */
	addMembers: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const role = projectRoleSchema.safeParse(form.get('role'));
		const ids = [
			...new Set(
				form
					.getAll('userIds')
					.map((v) => intParam(String(v)))
					.filter((n): n is number => n !== null)
			)
		].slice(0, 100);
		if (!role.success || !ids.length)
			return fail(400, { errors: { member: 'Choose at least one person and a role' }, values: {} });
		try {
			for (const id of ids) addMember(user.id, access.project, id, role.data, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { membersAdded: ids.length };
	},

	changeRole: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const userId = intParam(String(form.get('userId')));
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!userId || !role.success)
			return fail(400, { errors: { member: 'Invalid request' }, values: {} });
		try {
			changeMemberRole(user.id, access.project, userId, role.data, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { roleChanged: true };
	},

	removeMember: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const userId = intParam(String((await request.formData()).get('userId')));
		if (!userId) return fail(400, { errors: { member: 'Invalid request' }, values: {} });
		try {
			removeMember(user.id, access.project, userId, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { removed: true };
	},

	invite: async ({ locals, params, request, url }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const rawEmail = String(form.get('email') ?? '').trim();
		const email = rawEmail ? emailSchema.safeParse(rawEmail) : null;
		if (email && !email.success)
			return fail(400, {
				errors: { inviteEmail: 'Enter a valid email or leave it empty' },
				values: { email: rawEmail }
			});
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!role.success) return fail(400, { errors: { inviteEmail: 'Choose a role' }, values: {} });
		// Project invitations never grant a global administrator role.
		const token = createInvitation(
			user.id,
			{
				email: email?.success ? email.data : null,
				role: 'user',
				projectId: access.project.id,
				projectRole: role.data
			},
			locals.clientIp
		);
		const base = getSettings().appUrl || url.origin;
		const inviteLink = `${base.replace(/\/$/, '')}/invite/${token}`;
		const emailResult = email?.success
			? await sendInvitationEmail(email.data, inviteLink, {
					inviterName: user.displayName,
					projectName: access.project.name,
					expiresAt: new Date(Date.now() + getSettings().invitationLifetimeDays * 864e5)
				})
			: null;
		return { inviteLink, emailResult };
	},

	revokeInvite: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const id = intParam(String((await request.formData()).get('invitationId')));
		if (!id || !revokeInvitation(user.id, id, access.project.id, locals.clientIp))
			error(404, 'Invitation not found');
		return { revoked: true };
	}
};
