import { apiLimits } from '$lib/server/api/http';
import { ENDPOINTS } from '$lib/server/api/openapi';
import { publicBaseUrl } from '$lib/server/email/notifications';
import { PAT_SCOPES, PROJECT_TOKEN_SCOPES, SCOPE_META } from '$lib/shared/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({
	title: 'API documentation',
	endpoints: ENDPOINTS,
	baseUrl: publicBaseUrl() || url.origin,
	limits: { read: apiLimits.read, write: apiLimits.write },
	personalScopes: PAT_SCOPES.map((s) => ({ scope: s, description: SCOPE_META[s] })),
	projectScopes: PROJECT_TOKEN_SCOPES.map((s) => ({ scope: s, description: SCOPE_META[s] }))
});
