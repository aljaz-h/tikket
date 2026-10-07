import { requireProject } from '$lib/server/authz';
import { intParam } from '$lib/server/http';
import { listRules, listRuns } from '$lib/server/automations/rules';
import { getTicket } from '$lib/server/services/tickets';
import { parseTicketReference } from '$lib/shared/workflow';
import { AUTOMATION_RUN_STATUSES, type AutomationRunStatus } from '$lib/shared/constants';
import type { PageServerLoad } from './$types';

const date = (v: string | null, end = false) => {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
	const d = new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}Z`);
	return Number.isNaN(d.getTime()) ? null : d;
};

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'staff');
	const q = url.searchParams;
	const status = q.get('status');
	const ticketRef = q.get('ticket')?.trim() ?? '';
	const number = ticketRef ? parseTicketReference(ticketRef, access.project.key) : null;
	const ticket = number ? getTicket(access.project.id, number) : undefined;
	const filters = {
		automationId: intParam(q.get('automation')),
		status: (AUTOMATION_RUN_STATUSES as readonly string[]).includes(status ?? '')
			? (status as AutomationRunStatus)
			: null,
		ticketId: ticketRef ? (ticket?.id ?? -1) : null,
		from: date(q.get('from')),
		to: date(q.get('to'), true),
		before: intParam(q.get('before'))
	};
	return {
		title: `History · Automations · ${access.project.name}`,
		...listRuns(access.project.id, filters),
		rules: listRules(access.project.id).map((r) => ({ id: r.id, name: r.name })),
		filters: {
			automation: q.get('automation') ?? '',
			status: status ?? '',
			ticket: ticketRef,
			from: q.get('from') ?? '',
			to: q.get('to') ?? ''
		}
	};
};
