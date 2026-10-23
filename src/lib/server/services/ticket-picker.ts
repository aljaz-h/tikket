import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { RESOLVED_STATUSES } from '../../shared/constants';
import { getDb, schema } from '../db';

const t = schema.tickets;
const m = schema.milestones;
const r = schema.changelogEntries;
const LIMIT = 500;

/**
 * Tickets a staff member can pick to add to a milestone or release: every ticket of the project
 * that is not already in it. Open tickets come first, newest first. `elsewhere` names the
 * milestone/release the ticket currently belongs to, because adding it moves it.
 */
export function pickableTickets(
	projectId: number,
	target: { kind: 'milestone' | 'release'; id: number }
) {
	const column = target.kind === 'milestone' ? t.milestoneId : t.releaseId;
	const resolved = sql.join(
		RESOLVED_STATUSES.map((s) => sql`${s}`),
		sql`, `
	);
	const rows = getDb()
		.select({
			number: t.number,
			title: t.title,
			type: t.type,
			status: t.status,
			milestoneName: m.name,
			releaseVersion: r.version
		})
		.from(t)
		.leftJoin(m, eq(m.id, t.milestoneId))
		.leftJoin(r, eq(r.id, t.releaseId))
		.where(and(eq(t.projectId, projectId), or(isNull(column), ne(column, target.id))))
		.orderBy(sql`case when ${t.status} in (${resolved}) then 1 else 0 end`, desc(t.number))
		.limit(LIMIT)
		.all();
	return rows.map((x) => ({
		number: x.number,
		title: x.title,
		type: x.type,
		status: x.status,
		elsewhere: (target.kind === 'milestone' ? x.milestoneName : x.releaseVersion) ?? null
	}));
}
export type PickableTicket = ReturnType<typeof pickableTickets>[number];
