import { adminActor } from '$lib/server/admin';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { listAuditLogs } from '$lib/server/services/audit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminActor(locals);
	const db = getDb();
	const count = (
		table:
			| typeof schema.users
			| typeof schema.projects
			| typeof schema.tickets
			| typeof schema.ticketComments
			| typeof schema.attachments
	) =>
		db
			.select({ n: sql<number>`count(*)` })
			.from(table)
			.get()?.n ?? 0;
	const storage =
		db
			.select({ n: sql<number>`coalesce(sum(size), 0)` })
			.from(schema.attachments)
			.get()?.n ?? 0;
	return {
		title: 'Administration',
		stats: {
			users: count(schema.users),
			projects: count(schema.projects),
			tickets: count(schema.tickets),
			comments: count(schema.ticketComments),
			attachments: count(schema.attachments),
			storage
		},
		recentAudit: listAuditLogs({ page: 1, pageSize: 8 }).rows
	};
};
