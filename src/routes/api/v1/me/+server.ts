import { apiHandler, ok } from '$lib/server/api/http';
import type { RequestHandler } from './$types';

/** The token's identity: who it acts as, its kind, scopes and (for project tokens) project. */
export const GET: RequestHandler = apiHandler({ personal: 'any', project: 'any' }, {}, ({ auth }) =>
	ok({
		user: { username: auth.user.username, name: auth.user.displayName },
		token: { kind: auth.kind, name: auth.tokenName, prefix: auth.prefix, scopes: auth.scopes },
		project: auth.project ? { key: auth.project.key, name: auth.project.name } : null
	})
);
