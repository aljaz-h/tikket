import { requireAdmin } from '$lib/server/http';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	requireAdmin(locals, url);
	return {};
};
