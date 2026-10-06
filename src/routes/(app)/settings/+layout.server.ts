import { requireUser } from '$lib/server/http';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireUser(locals, url);
	return {};
};
