import { handleServiceError, requireActionUser } from '$lib/server/http';
import { presentTokens, rateLimited, readTokenForm } from '$lib/server/api/token-actions';
import { createPersonalToken, listTokens, revokeToken } from '$lib/server/api/tokens';
import { PAT_SCOPES } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	title: 'Developer',
	tokens: presentTokens(listTokens({ userId: locals.user!.id, kind: 'personal' })),
	scopes: [...PAT_SCOPES]
});

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const limited = rateLimited(`pat:${user.id}`);
		if (limited) return limited;
		const input = readTokenForm(await request.formData());
		try {
			const { token, record } = createPersonalToken(user, input, locals.clientIp);
			// The only time the full token leaves the server.
			return { created: { id: record.id, name: record.name, token } };
		} catch (err) {
			return handleServiceError(err, { name: input.name });
		}
	},
	revoke: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const id = Number((await request.formData()).get('id'));
		try {
			revokeToken(user.id, id, { kind: 'personal' }, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { revoked: true };
	}
};
