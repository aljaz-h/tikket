import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { adminActor } from '$lib/server/admin';
import { getDb, schema } from '$lib/server/db';
import { handleServiceError, intParam } from '$lib/server/http';
import {
	createPasswordReset,
	getUser,
	listUserSessions,
	revokeUserSessions,
	setUserRole,
	setUserStatus
} from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import { globalRoleSchema } from '$lib/server/validation';
import { sendAdminResetEmail } from '$lib/server/email/account';
import { emailEnabled } from '$lib/server/email/config';
import type { Actions, PageServerLoad } from './$types';

function target(id: string) {
	const userId = intParam(id);
	const user = userId ? getUser(userId) : undefined;
	if (!user) error(404, 'User not found');
	return user;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	adminActor(locals);
	const user = target(params.id);
	const memberships = getDb()
		.select({
			role: schema.projectMembers.role,
			key: schema.projects.key,
			name: schema.projects.name,
			icon: schema.projects.icon,
			logoId: schema.projects.logoId,
			color: schema.projects.color
		})
		.from(schema.projectMembers)
		.innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
		.where(eq(schema.projectMembers.userId, user.id))
		.all();
	return {
		title: user.displayName,
		target: {
			id: user.id,
			username: user.username,
			email: user.email,
			displayName: user.displayName,
			avatarId: user.avatarId,
			role: user.role,
			status: user.status,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt
		},
		memberships,
		sessionCount: listUserSessions(user.id).length,
		isSelf: user.id === locals.user!.id
	};
};

export const actions: Actions = {
	role: async ({ locals, params, request }) => {
		const admin = adminActor(locals);
		const user = target(params.id);
		const role = globalRoleSchema.safeParse((await request.formData()).get('role'));
		if (!role.success) error(400, 'Invalid role');
		try {
			setUserRole(admin.id, user.id, role.data, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { done: 'role' };
	},
	disable: async ({ locals, params }) => {
		const admin = adminActor(locals);
		try {
			setUserStatus(admin.id, target(params.id).id, 'disabled', locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { done: 'disabled' };
	},
	enable: async ({ locals, params }) => {
		const admin = adminActor(locals);
		try {
			setUserStatus(admin.id, target(params.id).id, 'active', locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { done: 'enabled' };
	},
	revokeSessions: async ({ locals, params }) => {
		const admin = adminActor(locals);
		const user = target(params.id);
		if (user.id === admin.id) error(400, 'Use “Sign out other sessions” in your own settings');
		return { revoked: revokeUserSessions(admin.id, user.id, locals.clientIp) };
	},
	resetLink: async ({ locals, params, url }) => {
		const admin = adminActor(locals);
		const user = target(params.id);
		const token = createPasswordReset(admin.id, user.id, locals.clientIp);
		const resetLink = `${(getSettings().appUrl || url.origin).replace(/\/$/, '')}/reset/${token}`;
		const emailResult = emailEnabled() ? await sendAdminResetEmail(user.id, resetLink) : null;
		return { resetLink, emailResult };
	}
};
