import { adminActor } from '$lib/server/admin';
import { healthReport } from '$lib/server/ops';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminActor(locals);
	return { title: 'Health', health: healthReport() };
};
