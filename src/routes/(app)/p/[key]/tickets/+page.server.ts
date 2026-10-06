import { eq } from 'drizzle-orm';
import { requireProject } from '$lib/server/authz';
import { schema } from '$lib/server/db';
import { listAssignableUsers, listLabels } from '$lib/server/services/projects';
import { boardTickets, queryTickets } from '$lib/server/services/search';
import { parseTicketFilters } from '$lib/shared/filters';
import { PAGE_SIZE } from '$lib/shared/constants';
import { fail } from '@sveltejs/kit';
import { requireActionUser } from '$lib/server/http';
import { bulkUpdate, parseBulkForm } from '$lib/server/services/bulk';
import { ServiceError } from '$lib/server/services/users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const filters = parseTicketFilters(url.searchParams);
	const view: 'board' | 'list' = url.searchParams.get('view') === 'board' ? 'board' : 'list';
	const base = {
		scope: eq(schema.tickets.projectId, access.project.id),
		filters,
		projectKey: access.project.key,
		actorId: locals.user?.id
	};
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

export const actions: Actions = {
	bulk: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		try {
			const { op, numbers } = parseBulkForm(await request.formData());
			return { bulk: bulkUpdate(user, access, numbers, op) };
		} catch (err) {
			if (err instanceof ServiceError)
				return fail(err.status === 403 ? 403 : 400, { errors: { bulk: err.message } });
			throw err;
		}
	}
};
