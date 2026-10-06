import { and, eq, sql } from 'drizzle-orm';
import { schema } from '$lib/server/db';
import { requireUser } from '$lib/server/http';
import { queryTickets, viewableTicketsCondition } from '$lib/server/services/search';
import { PAGE_SIZE, RESOLVED_STATUSES } from '$lib/shared/constants';
import { parseTicketFilters } from '$lib/shared/filters';
import type { PageServerLoad } from './$types';

const TABS = ['created', 'following', 'assigned', 'completed'] as const;
type Tab = (typeof TABS)[number];

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, url);
	const tab: Tab = TABS.includes(url.searchParams.get('tab') as Tab)
		? (url.searchParams.get('tab') as Tab)
		: 'created';
	const t = schema.tickets;
	const scopes: Record<Tab, ReturnType<typeof and>> = {
		created: eq(t.reporterId, user.id),
		following: sql`${t.id} in (select ticket_id from ticket_followers where user_id = ${user.id})`,
		assigned: eq(t.assigneeId, user.id),
		completed: and(
			sql`(${t.reporterId} = ${user.id} or ${t.id} in (select ticket_id from ticket_followers where user_id = ${user.id}))`,
			sql`${t.status} in (${sql.join(
				RESOLVED_STATUSES.map((s) => sql`${s}`),
				sql`, `
			)})`
		)
	};
	const filters = parseTicketFilters(url.searchParams);
	const result = queryTickets({
		scope: and(viewableTicketsCondition(user), scopes[tab]),
		filters,
		pageSize: PAGE_SIZE,
		actorId: user.id
	});
	return { title: 'My tickets', tab, filters, result };
};
