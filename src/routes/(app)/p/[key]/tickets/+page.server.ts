import { eq } from 'drizzle-orm';
import { requireProject } from '$lib/server/authz';
import { schema } from '$lib/server/db';
import { listAssignableUsers, listLabels } from '$lib/server/services/projects';
import { boardTickets, queryTickets } from '$lib/server/services/search';
import { parseTicketFilters } from '$lib/shared/filters';
import { PAGE_SIZE } from '$lib/shared/constants';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const filters = parseTicketFilters(url.searchParams);
	const view: 'board' | 'list' = url.searchParams.get('view') === 'board' ? 'board' : 'list';
	const base = { scope: eq(schema.tickets.projectId, access.project.id), filters, projectKey: access.project.key, actorId: locals.user?.id };
	return {
		title: `Tickets · ${access.project.name}`,
		view,
		filters,
		list: view === 'list' ? queryTickets({ ...base, pageSize: PAGE_SIZE }) : null,
		board: view === 'board' ? boardTickets(base) : null,
		labels: listLabels(access.project.id),
		assignable: listAssignableUsers(access.project.id)
	};
};
