import { hookActions, loadHooks } from '$lib/server/integrations/hook-actions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => ({
	title: 'Discord · Integrations',
	...loadHooks(locals, params.key, 'discord')
});

export const actions: Actions = hookActions('discord');
