import { requireProject } from '$lib/server/authz';
import { connectionForDisplay, getConnection } from '$lib/server/integrations/github';
import { listHooks } from '$lib/server/integrations/hooks';
import { encryptionAvailable } from '$lib/server/secrets';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	const hooks = listHooks(access.project.id);
	const health = (kind: 'discord' | 'webhook') => {
		const list = hooks.filter((h) => h.kind === kind);
		const failing = list.filter(
			(h) => h.enabled && h.lastFailureAt && (!h.lastSuccessAt || h.lastFailureAt > h.lastSuccessAt)
		);
		return {
			total: list.length,
			active: list.filter((h) => h.enabled).length,
			failing: failing.length,
			lastSuccessAt:
				list
					.map((h) => h.lastSuccessAt)
					.filter((d): d is Date => !!d)
					.sort((a, b) => b.getTime() - a.getTime())[0] ?? null
		};
	};
	return {
		title: 'Integrations',
		github: connectionForDisplay(getConnection(access.project.id)),
		discord: health('discord'),
		webhooks: health('webhook'),
		encryptionAvailable: encryptionAvailable()
	};
};
