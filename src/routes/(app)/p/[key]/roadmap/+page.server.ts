import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { requireTicket } from '$lib/server/ticket-context';
import { isAssignable } from '$lib/server/services/projects';
import { canViewRoadmap, roadmapFor, roadmapSettings } from '$lib/server/services/roadmap';
import { assignTicket, changeStatus, setVote } from '$lib/server/services/tickets';
import { workflowFor } from '$lib/server/services/workflow';
import { parseForm, statusSchema } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const settings = roadmapSettings(access.project);
	// Same answer as for a page that doesn't exist: the roadmap's existence isn't revealed.
	if (!canViewRoadmap(access, settings)) error(404, 'Not found');
	const staff = access.isStaff && !access.archived;
	return {
		title: `Roadmap · ${access.project.name}`,
		roadmap: roadmapFor(
			access.project,
			settings,
			access.isStaff,
			undefined,
			locals.user?.id ?? null
		),
		// One "now" for server and browser, so relative dates ("3d ago") render identically.
		now: Date.now(),
		// The vote buttons use the ticket page's own voting rules.
		canVote: access.canVote && access.project.votingEnabled,
		audience: settings.audience,
		// Only staff can move tickets; the browser needs the rules to offer valid targets.
		workflow: staff ? workflowFor(access.project) : null,
		// "Assign to me" is offered only to staff who can actually be assignees.
		canAssignSelf: staff && !!locals.user && isAssignable(access.project.id, locals.user.id),
		imageAvailable: true
	};
};

export const actions: Actions = {
	/**
	 * Moves a ticket to another roadmap column. This is the ticket page's own status change:
	 * same service, so workflow rules, activity history, notifications, integrations and
	 * automations all apply exactly as they do there.
	 */
	move: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const { access, ticket } = requireTicket(
			user,
			params.key,
			String(form.get('number') ?? ''),
			'staff'
		);
		const parsed = parseForm(statusSchema, form);
		if (!parsed.ok) return parsed.failure;
		try {
			changeStatus(user, access, ticket, { ...parsed.data, duplicateOf: undefined });
		} catch (err) {
			return handleServiceError(err);
		}
		return { moved: ticket.number, status: parsed.data.status };
	},

	/** Votes from the roadmap card: the ticket page's vote, same service and rules. */
	vote: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const { access, ticket } = requireTicket(
			user,
			params.key,
			String(form.get('number') ?? ''),
			'vote'
		);
		try {
			const voteCount = setVote(user, access, ticket, form.get('on') === 'true');
			return { voted: ticket.number, voteCount };
		} catch (err) {
			return handleServiceError(err);
		}
	},

	assign: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const { access, ticket } = requireTicket(
			user,
			params.key,
			String(form.get('number') ?? ''),
			'staff'
		);
		try {
			// Self-assignment only: assigning others stays on the ticket page.
			assignTicket(user, access, ticket, user.id);
		} catch (err) {
			return handleServiceError(err);
		}
		return { assigned: ticket.number };
	}
};
