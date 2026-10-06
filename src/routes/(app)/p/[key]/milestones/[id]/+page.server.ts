import { error, fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { parseMilestoneForm, requireStaffView } from '$lib/server/planning-forms';
import {
	getMilestone,
	milestoneTickets,
	setMilestoneStatus,
	setTicketMilestone,
	updateMilestone
} from '$lib/server/services/milestones';
import { listProjectActivity } from '$lib/server/services/project-activity';
import { progressFor } from '$lib/server/services/releases';
import { getTicket } from '$lib/server/services/tickets';
import { MILESTONE_STATUSES, type MilestoneStatus } from '$lib/shared/constants';
import { parseTicketReference } from '$lib/shared/workflow';
import type { Actions, PageServerLoad } from './$types';

function milestoneFrom(access: ReturnType<typeof requireProject>, idParam: string) {
	const id = intParam(idParam);
	const milestone = id ? getMilestone(access.project.id, id) : undefined;
	if (!milestone) error(404, 'Milestone not found');
	return milestone;
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireStaffView(requireProject(locals.user, params.key, 'view'));
	const milestone = milestoneFrom(access, params.id);
	return {
		title: `${milestone.name} · Milestones · ${access.project.name}`,
		milestone,
		tickets: milestoneTickets(milestone.id),
		progress: progressFor('milestone', [milestone.id]).get(milestone.id)!,
		activity: listProjectActivity(access.project.id, 'milestone', milestone.id),
		canEdit: !access.archived
	};
};

export const actions: Actions = {
	update: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const milestone = milestoneFrom(access, params.id);
		const parsed = parseMilestoneForm(await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			updateMilestone(user, access, milestone.id, parsed.data);
		} catch (err) {
			return handleServiceError(err);
		}
		return { updated: true };
	},
	status: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const milestone = milestoneFrom(access, params.id);
		const status = String((await request.formData()).get('status')) as MilestoneStatus;
		if (!MILESTONE_STATUSES.includes(status)) error(400, 'Unknown status');
		try {
			setMilestoneStatus(user, access, milestone.id, status);
		} catch (err) {
			return handleServiceError(err);
		}
		return { status };
	},
	addTicket: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const milestone = milestoneFrom(access, params.id);
		const ref = String((await request.formData()).get('ticket') ?? '').trim();
		const number = parseTicketReference(ref, access.project.key);
		const ticket = number ? getTicket(access.project.id, number) : undefined;
		if (!ticket)
			return fail(400, {
				errors: { ticket: `No ticket ${ref || ''} in this project`.trim() },
				values: { ticket: ref }
			});
		try {
			setTicketMilestone(user, access, ticket, milestone.id);
		} catch (err) {
			return handleServiceError(err, { ticket: ref });
		}
		return { added: number };
	},
	removeTicket: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const milestone = milestoneFrom(access, params.id);
		const number = intParam(String((await request.formData()).get('ticket') ?? ''));
		const ticket = number ? getTicket(access.project.id, number) : undefined;
		if (!ticket || ticket.milestoneId !== milestone.id) error(404, 'Ticket not found');
		try {
			setTicketMilestone(user, access, ticket, null);
		} catch (err) {
			return handleServiceError(err);
		}
		return { removed: number };
	}
};
