import { error, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { parseReleaseForm, requireStaffView } from '$lib/server/planning-forms';
import { listProjectActivity } from '$lib/server/services/project-activity';
import {
	addTicketsToRelease,
	deleteRelease,
	getRelease,
	progressFor,
	releaseTickets,
	setTicketRelease,
	updateRelease
} from '$lib/server/services/releases';
import { getTicket } from '$lib/server/services/tickets';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

function releaseFrom(access: ReturnType<typeof requireProject>, idParam: string) {
	const id = intParam(idParam);
	const release = id ? getRelease(access.project.id, id) : undefined;
	if (!release) error(404, 'Release not found');
	return release;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireStaffView(requireProject(locals.user, params.key, 'view'));
	const release = releaseFrom(access, params.id);
	return {
		title: `${release.version} · Releases · ${access.project.name}`,
		release,
		tickets: releaseTickets(release.id),
		progress: progressFor('release', [release.id]).get(release.id)!,
		activity: listProjectActivity(access.project.id, 'release', release.id),
		canEdit: !access.archived,
		canPublish: access.isOwner && !access.archived
	};
};

export const actions: Actions = {
	update: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const release = releaseFrom(access, params.id);
		const parsed = parseReleaseForm(await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			updateRelease(user, access, release.id, parsed.data);
		} catch (err) {
			return handleServiceError(err);
		}
		return { updated: true };
	},
	delete: async ({ locals, params }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const release = releaseFrom(access, params.id);
		try {
			deleteRelease(user, access, release.id);
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, 'releases'));
	},
	addTickets: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const release = releaseFrom(access, params.id);
		const refs = String((await request.formData()).get('tickets') ?? '')
			.split(/[\s,]+/)
			.map((r) => r.trim())
			.filter(Boolean)
			.slice(0, 100);
		if (!refs.length) return { added: 0 };
		try {
			return { added: addTicketsToRelease(user, access, release.id, refs) };
		} catch (err) {
			return handleServiceError(err, { tickets: refs.join(' ') });
		}
	},
	removeTicket: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const release = releaseFrom(access, params.id);
		const number = intParam(String((await request.formData()).get('ticket') ?? ''));
		const ticket = number ? getTicket(access.project.id, number) : undefined;
		if (!ticket || ticket.releaseId !== release.id) error(404, 'Ticket not found');
		try {
			setTicketRelease(user, access, ticket, null);
		} catch (err) {
			return handleServiceError(err);
		}
		return { removed: number };
	}
};
