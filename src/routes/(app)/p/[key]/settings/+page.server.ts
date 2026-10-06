import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { createInvitation, listInvitations, revokeInvitation } from '$lib/server/services/invitations';
import {
	addMember,
	changeMemberRole,
	createLabel,
	deleteLabel,
	listLabels,
	listMembers,
	removeMember,
	setArchived,
	updateLabel,
	updateProject
} from '$lib/server/services/projects';
import { findUserByIdentifier } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { email as emailSchema, parseForm, projectRoleSchema, projectSettingsSchema } from '$lib/server/validation';
import { LABEL_COLORS } from '$lib/shared/constants';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Settings · ${access.project.name}`,
		members: listMembers(access.project.id),
		labels: listLabels(access.project.id),
		invitations: listInvitations(access.project.id).filter((i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date()),
		invitationLifetimeDays: getSettings().invitationLifetimeDays
	};
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

const labelSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(40), color: z.enum(LABEL_COLORS) });

export const actions: Actions = {
	update: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		if (access.archived) error(403, 'Unarchive the project before changing its settings');
		const form = await request.formData();
		const parsed = parseForm(projectSettingsSchema, form);
		if (!parsed.ok) return parsed.failure;
		let key: string;
		try {
			key = updateProject(user.id, access.project, parsed.data, locals.clientIp).key;
		} catch (err) {
			return handleServiceError(err, Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
		}
		if (key !== access.project.key) redirect(303, projectPath(key, 'settings'));
		return { updated: true };
	},

	addMember: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim();
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!identifier || !role.success) return fail(400, { errors: { member: 'Enter a username or email and a role' }, values: { identifier } });
		const target = findUserByIdentifier(identifier);
		if (!target || target.status !== 'active') return fail(400, { errors: { member: 'No active user with that username or email. Send an invitation instead.' }, values: { identifier } });
		try {
			addMember(user.id, access.project, target.id, role.data, locals.clientIp);
		} catch (err) {
			return handleServiceError(err, { identifier });
		}
		return { memberAdded: target.displayName };
	},

	changeRole: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const userId = intParam(String(form.get('userId')));
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!userId || !role.success) return fail(400, { errors: { member: 'Invalid request' }, values: {} });
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
		if (email && !email.success) return fail(400, { errors: { inviteEmail: 'Enter a valid email or leave it empty' }, values: { email: rawEmail } });
		const role = projectRoleSchema.safeParse(form.get('role'));
		if (!role.success) return fail(400, { errors: { inviteEmail: 'Choose a role' }, values: {} });
		// Project invitations never grant a global administrator role.
		const token = createInvitation(user.id, { email: email?.success ? email.data : null, role: 'user', projectId: access.project.id, projectRole: role.data }, locals.clientIp);
		const base = getSettings().appUrl || url.origin;
		return { inviteLink: `${base.replace(/\/$/, '')}/invite/${token}` };
	},

	revokeInvite: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const id = intParam(String((await request.formData()).get('invitationId')));
		if (!id || !revokeInvitation(user.id, id, access.project.id, locals.clientIp)) error(404, 'Invitation not found');
		return { revoked: true };
	},

	createLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const parsed = parseForm(labelSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			createLabel(access.project.id, parsed.data.name, parsed.data.color);
		} catch (err) {
			return handleServiceError(err);
		}
		return { labelCreated: true };
	},

	updateLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const form = await request.formData();
		const id = intParam(String(form.get('labelId')));
		const parsed = parseForm(labelSchema, form);
		if (!parsed.ok) return parsed.failure;
		if (!id) error(404, 'Label not found');
		try {
			if (!updateLabel(access.project.id, id, parsed.data.name, parsed.data.color)) error(404, 'Label not found');
		} catch (err) {
			return handleServiceError(err);
		}
		return { labelUpdated: true };
	},

	deleteLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const id = intParam(String((await request.formData()).get('labelId')));
		if (!id || !deleteLabel(access.project.id, id)) error(404, 'Label not found');
		return { labelDeleted: true };
	},

	archive: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		setArchived(user.id, access.project, true, locals.clientIp);
		return { archived: true };
	},

	unarchive: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		setArchived(user.id, access.project, false, locals.clientIp);
		return { archived: false };
	}
};
