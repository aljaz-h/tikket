import { getSettings } from '$lib/server/settings';
import { hookActions, loadHooks } from '$lib/server/integrations/hook-actions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => ({
	title: 'Webhooks · Integrations',
	appName: getSettings().appName,
	...loadHooks(locals, params.key, 'webhook')
});

export const actions: Actions = hookActions('webhook');
