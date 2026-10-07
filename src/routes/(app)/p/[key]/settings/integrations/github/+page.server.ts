import { fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import {
	connectInput,
	connectRepository,
	connectionForDisplay,
	disconnectRepository,
	getConnection,
	regenerateWebhookSecret,
	testConnection,
	updateConnection
} from '$lib/server/integrations/github';
import { requireIntegrationManager } from '$lib/server/integrations/hooks';
import { encryptionAvailable } from '$lib/server/secrets';
import { getSettings } from '$lib/server/settings';
import { MERGE_ACTIONS, type MergeAction } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	const conn = connectionForDisplay(getConnection(access.project.id));
	const base = (getSettings().appUrl || url.origin).replace(/\/$/, '');
	return {
		title: 'GitHub · Integrations',
		connection: conn,
		webhookUrl: conn ? `${base}/api/integrations/github/${conn.publicId}` : null,
		encryptionAvailable: encryptionAvailable(),
		archived: access.archived
	};
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

export const actions: Actions = {
	connect: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const values = { repository: String(form.get('repository') ?? '') };
		const parsed = connectInput.safeParse({
			repository: values.repository,
			token: String(form.get('token') ?? '').trim() || undefined,
			mergeAction: String(form.get('mergeAction') ?? 'none')
		});
		if (!parsed.success)
			return fail(400, { errors: { repository: 'Check the repository' }, values });
		try {
			const { secret } = connectRepository(user.id, access, parsed.data, locals.clientIp);
			return { connected: true, secret };
		} catch (err) {
			return handleServiceError(err, values);
		}
	},
	update: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const form = await request.formData();
		const mergeAction = String(form.get('mergeAction') ?? 'none') as MergeAction;
		if (!MERGE_ACTIONS.includes(mergeAction))
			return fail(400, { errors: { mergeAction: 'Choose what happens on merge' } });
		try {
			updateConnection(
				user.id,
				access,
				{
					mergeAction,
					token: String(form.get('token') ?? '').trim() || undefined,
					clearToken: form.get('clearToken') === 'on'
				},
				locals.clientIp
			);
		} catch (err) {
			return handleServiceError(err);
		}
		return { updated: true };
	},
	secret: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		try {
			return { secret: regenerateWebhookSecret(user.id, access, locals.clientIp) };
		} catch (err) {
			return handleServiceError(err);
		}
	},
	test: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		try {
			requireIntegrationManager(access);
		} catch (err) {
			return handleServiceError(err);
		}
		const wait = limiters.outboundTest.hit(`user:${user.id}`);
		if (wait)
			return fail(429, { errors: { form: `Too many tests. Try again in ${formatWait(wait)}.` } });
		const conn = getConnection(access.project.id);
		if (!conn) return fail(404, { errors: { form: 'No repository is connected' } });
		const result = await testConnection(conn);
		return result.ok ? { tested: result.message } : fail(400, { errors: { form: result.message } });
	},
	disconnect: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		try {
			disconnectRepository(user.id, access, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { disconnected: true };
	}
};
