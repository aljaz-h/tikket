import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { listAssignableUsers } from '../services/projects';

/** Everything the rule editor offers as choices – only this project's objects. */
export function editorOptions(projectId: number) {
	const db = getDb();
	const members = db
		.select({
			id: schema.users.id,
			name: schema.users.displayName,
			username: schema.users.username
		})
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(eq(schema.projectMembers.projectId, projectId))
		.orderBy(schema.users.displayName)
		.all();
	return {
		labels: db
			.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
			.from(schema.ticketLabels)
			.where(eq(schema.ticketLabels.projectId, projectId))
			.orderBy(schema.ticketLabels.name)
			.all(),
		milestones: db
			.select({ id: schema.milestones.id, name: schema.milestones.name })
			.from(schema.milestones)
			.where(and(eq(schema.milestones.projectId, projectId), eq(schema.milestones.status, 'open')))
			.all(),
		releases: db
			.select({ id: schema.changelogEntries.id, name: schema.changelogEntries.version })
			.from(schema.changelogEntries)
			.where(
				and(
					eq(schema.changelogEntries.projectId, projectId),
					inArray(schema.changelogEntries.status, ['planned', 'in_progress'])
				)
			)
			.all(),
		staff: listAssignableUsers(projectId).map((u) => ({
			id: u.id,
			name: u.displayName,
			username: u.username
		})),
		members,
		hooks: db
			.select({
				id: schema.projectHooks.id,
				name: schema.projectHooks.name,
				kind: schema.projectHooks.kind
			})
			.from(schema.projectHooks)
			.where(eq(schema.projectHooks.projectId, projectId))
			.all(),
		recentTickets: db
			.select({ number: schema.tickets.number, title: schema.tickets.title })
			.from(schema.tickets)
			.where(eq(schema.tickets.projectId, projectId))
			.orderBy(desc(schema.tickets.id))
			.limit(30)
			.all()
	};
}
export type EditorOptions = ReturnType<typeof editorOptions>;
