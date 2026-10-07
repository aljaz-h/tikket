import { requireProject } from '$lib/server/authz';
import { getDb, schema } from '$lib/server/db';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { saveWorkflow, workflowFor } from '$lib/server/services/workflow';
import {
	DEFAULT_WORKFLOW,
	TICKET_STATUSES,
	type TicketPriority,
	type TicketStatus,
	type WorkflowSettings
} from '$lib/shared/constants';
import { count, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	// How many tickets sit in each status: disabling a status never changes them.
	const counts = Object.fromEntries(
		getDb()
			.select({ status: schema.tickets.status, n: count() })
			.from(schema.tickets)
			.where(eq(schema.tickets.projectId, access.project.id))
			.groupBy(schema.tickets.status)
			.all()
			.map((r) => [r.status, r.n])
	) as Partial<Record<TicketStatus, number>>;
	return {
		title: `Workflow · Settings · ${access.project.name}`,
		workflow: workflowFor(access.project),
		counts
	};
};

/** Reads the form: checkbox groups for statuses and one group per transition row. */
function readForm(form: FormData): WorkflowSettings {
	const statuses = (name: string) =>
		form.getAll(name).filter((v): v is TicketStatus => TICKET_STATUSES.includes(v as TicketStatus));
	const restrict = form.get('restrict') === 'on';
	return {
		enabled: statuses('enabled'),
		defaultStatus: String(form.get('defaultStatus') ?? '') as TicketStatus,
		defaultPriority: String(form.get('defaultPriority') ?? '') as TicketPriority,
		transitions: restrict
			? (Object.fromEntries(
					TICKET_STATUSES.map((s) => [s, statuses(`to_${s}`)])
				) as WorkflowSettings['transitions'])
			: null,
		reporterCanReopen: form.get('reporterCanReopen') === 'on',
		commentsOnCompleted: form.get('commentsOnCompleted') === 'on',
		requireNote: statuses('requireNote')
	};
}

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		try {
			saveWorkflow(user.id, access, readForm(await request.formData()), locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { saved: true };
	},
	reset: async ({ locals, params }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		try {
			saveWorkflow(user.id, access, DEFAULT_WORKFLOW, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { saved: true };
	}
};
