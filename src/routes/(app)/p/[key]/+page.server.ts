import { requireProject } from '$lib/server/authz';
import { listChangelog } from '$lib/server/services/changelog';
import { projectStats, roadmap } from '$lib/server/services/dashboard';
import { queryTickets } from '$lib/server/services/search';
import { parseTicketFilters } from '$lib/shared/filters';
import { eq } from 'drizzle-orm';
import { schema } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const id = access.project.id;
	const filters = parseTicketFilters(new URLSearchParams());
	const road = roadmap(id);
	return {
		title: access.project.name,
		stats: projectStats(id),
		recent: queryTickets({ scope: eq(schema.tickets.projectId, id), filters, pageSize: 8, projectKey: access.project.key }).rows,
		topVoted: queryTickets({ scope: eq(schema.tickets.projectId, id), filters: { ...filters, sort: 'votes', status: ['open', 'planned', 'in_progress', 'on_hold'] }, pageSize: 5 }).rows,
		upcoming: [...road.in_progress.slice(0, 4), ...road.planned.slice(0, 4)],
		changelog: listChangelog(id, false).slice(0, 2)
	};
};
