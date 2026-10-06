import { fail } from '@sveltejs/kit';
import { adminActor } from '$lib/server/admin';
import { handleServiceError } from '$lib/server/http';
import { createInvitation } from '$lib/server/services/invitations';
import { createUser, listUsers } from '$lib/server/services/users';
import { getSettings } from '$lib/server/settings';
import {
	accountSchema,
	email as emailSchema,
	globalRoleSchema,
	parseForm
} from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 30;

export const load: PageServerLoad = async ({ locals, url }) => {
	adminActor(locals);
	const q = url.searchParams.get('q') ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const result = listUsers({ q, page, pageSize: PAGE_SIZE });
	return {
		title: 'Users',
		q,
		page,
		pages: Math.max(1, Math.ceil(result.total / PAGE_SIZE)),
		...result
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const form = await request.formData();
		const parsed = parseForm(accountSchema, form);
		if (!parsed.ok) return parsed.failure;
		const role = globalRoleSchema.catch('user').parse(form.get('role'));
		try {
			const user = await createUser({ ...parsed.data, role }, admin, locals.clientIp);
			return { created: user.username };
		} catch (err) {
			return handleServiceError(err, {
				username: parsed.data.username,
				email: parsed.data.email,
				displayName: parsed.data.displayName
			});
		}
	},
	invite: async ({ locals, request, url }) => {
		const admin = adminActor(locals);
		const form = await request.formData();
		const raw = String(form.get('email') ?? '').trim();
		const email = raw ? emailSchema.safeParse(raw) : null;
		if (email && !email.success)
			return fail(400, {
				errors: { inviteEmail: 'Enter a valid email or leave it empty' },
				values: { email: raw }
			});
		const role = globalRoleSchema.catch('user').parse(form.get('role'));
		const token = createInvitation(
			admin.id,
			{ email: email?.success ? email.data : null, role, projectId: null, projectRole: null },
			locals.clientIp
		);
		return {
			inviteLink: `${(getSettings().appUrl || url.origin).replace(/\/$/, '')}/invite/${token}`
		};
	}
};
