import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { presentTokens, rateLimited, readTokenForm } from '$lib/server/api/token-actions';
import { createProjectToken, listTokens, revokeToken } from '$lib/server/api/tokens';
import { PROJECT_TOKEN_SCOPES } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Developer · Settings · ${access.project.name}`,
		tokens: presentTokens(listTokens({ projectId: access.project.id, kind: 'project' })),
		scopes: [...PROJECT_TOKEN_SCOPES]
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const limited = rateLimited(`prj:${user.id}`);
		if (limited) return limited;
		const input = readTokenForm(await request.formData());
		try {
			const { token, record } = createProjectToken(user.id, access, input, locals.clientIp);
			return { created: { id: record.id, name: record.name, token } };
		} catch (err) {
			return handleServiceError(err, { name: input.name });
		}
	},
	revoke: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const id = Number((await request.formData()).get('id'));
		try {
			revokeToken(user.id, id, { kind: 'project', access }, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { revoked: true };
	}
};
