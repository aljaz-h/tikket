import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { schema } from '$lib/server/db';
import { requireActionUser } from '$lib/server/http';
import { listAssignableUsers, listLabels } from '$lib/server/services/projects';
import { boardTickets, queryTickets } from '$lib/server/services/search';
import { bulkUpdate, parseBulkForm } from '$lib/server/services/bulk';
import { listMilestones } from '$lib/server/services/milestones';
import { listReleases } from '$lib/server/services/releases';
import {
	createView,
	deleteView,
	duplicateView,
	listViews,
	moveView,
	updateView
} from '$lib/server/services/views';
import { ServiceError } from '$lib/server/services/users';
import { filtersToParams, parseColumns, parseTicketFilters } from '$lib/shared/filters';
import { COLUMNS_COOKIE, PAGE_SIZE, type TicketColumn } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, cookies }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const staff = access.isStaff;
	const projectId = access.project.id;
	const filters = parseTicketFilters(url.searchParams);
	const view: 'board' | 'list' = url.searchParams.get('view') === 'board' ? 'board' : 'list';
	const labels = listLabels(projectId);
	const releases = staff ? listReleases(projectId) : [];
	const milestones = staff ? listMilestones(projectId) : [];

	// A view or link may refer to labels, releases or milestones that were deleted since:
	// drop those filters (and say so) instead of silently showing an empty list.
	const removed: string[] = [];
	const knownLabels = filters.labels.filter((id) => labels.some((l) => l.id === id));
	if (knownLabels.length !== filters.labels.length) removed.push('labels');
	filters.labels = knownLabels;
	if (!staff) {
		filters.release = '';
		filters.milestone = '';
	} else {
		if (/^\d+$/.test(filters.release) && !releases.some((r) => String(r.id) === filters.release)) {
			filters.release = '';
			removed.push('release');
		}
		if (
			/^\d+$/.test(filters.milestone) &&
			!milestones.some((m) => String(m.id) === filters.milestone)
		) {
			filters.milestone = '';
			removed.push('milestone');
		}
	}

	// Columns: from the link/view, else the user's last choice (cookie), else the defaults.
	const allowed = (c: TicketColumn) =>
		c !== 'project' && (staff || (c !== 'release' && c !== 'milestone'));
	const columns = parseColumns(url.searchParams.get('cols') ?? cookies.get(COLUMNS_COOKIE)).filter(
		allowed
	);

	const base = {
		scope: eq(schema.tickets.projectId, projectId),
		filters,
		projectKey: access.project.key,
		actorId: locals.user?.id,
		staff
	};
	const savedId = Number(url.searchParams.get('saved')) || null;
	return {
		title: `Tickets · ${access.project.name}`,
		view,
		filters,
		columns,
		listQuery: filtersToParams({ ...filters, page: 1 }).toString(),
		removedFilters: removed,
		list: view === 'list' ? queryTickets({ ...base, pageSize: PAGE_SIZE }) : null,
		board: view === 'board' ? boardTickets(base) : null,
		labels,
		assignable: listAssignableUsers(projectId),
		releases: releases.map((r) => ({ id: r.id, version: r.version, status: r.status })),
		milestones: milestones.map((m) => ({ id: m.id, name: m.name, status: m.status })),
		views: listViews(locals.user, access),
		savedId
	};
};

function serviceFailure(err: unknown, field = 'view') {
	if (err instanceof ServiceError)
		return fail(err.status === 403 ? 403 : err.status === 404 ? 404 : 400, {
			errors: { [err.field === 'form' ? field : err.field]: err.message }
		});
	throw err;
}

const viewId = (form: FormData) => Number(form.get('viewId')) || 0;

export const actions: Actions = {
	bulk: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		try {
			const { op, numbers } = parseBulkForm(await request.formData());
			return { bulk: bulkUpdate(user, access, numbers, op) };
		} catch (err) {
			return serviceFailure(err, 'bulk');
		}
	},

	saveView: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'view');
		const form = await request.formData();
		try {
			const view = createView(user, access, {
				name: String(form.get('name') ?? ''),
				query: String(form.get('query') ?? ''),
				columns: String(form.get('columns') ?? '').split(','),
				shared: form.get('shared') === 'on'
			});
			return { savedView: view };
		} catch (err) {
			return serviceFailure(err, 'name');
		}
	},

	updateView: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'view');
		const form = await request.formData();
		const name = form.get('name');
		const query = form.get('query');
		try {
			updateView(user, access, viewId(form), {
				name: name === null ? undefined : String(name),
				query: query === null ? undefined : String(query),
				columns: form.has('columns') ? String(form.get('columns')).split(',') : undefined
			});
			return { updatedView: viewId(form) };
		} catch (err) {
			return serviceFailure(err);
		}
	},

	duplicateView: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'view');
		try {
			return { savedView: duplicateView(user, access, viewId(await request.formData())) };
		} catch (err) {
			return serviceFailure(err);
		}
	},

	deleteView: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'view');
		try {
			deleteView(user, access, viewId(await request.formData()));
			return { deletedView: true };
		} catch (err) {
			return serviceFailure(err);
		}
	},

	moveView: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'view');
		const form = await request.formData();
		try {
			moveView(user, access, viewId(form), form.get('direction') === 'up' ? -1 : 1);
			return { movedView: true };
		} catch (err) {
			return serviceFailure(err);
		}
	}
};
