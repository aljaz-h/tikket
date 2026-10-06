import { and, eq, sql } from 'drizzle-orm';
import { adminActor } from '$lib/server/admin';
import { getDb, schema } from '$lib/server/db';
import { listProjects } from '$lib/server/services/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const admin = adminActor(locals);
	const owners = getDb()
		.select({ projectId: schema.projectMembers.projectId, name: schema.users.displayName })
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(and(eq(schema.projectMembers.role, 'owner')))
		.all();
	const memberCounts = getDb()
		.select({ projectId: schema.projectMembers.projectId, n: sql<number>`count(*)` })
		.from(schema.projectMembers)
		.groupBy(schema.projectMembers.projectId)
		.all();
	return {
		title: 'Projects',
		projects: listProjects(admin, { archived: 'all' }).map((p) => ({
			...p,
			owners: owners.filter((o) => o.projectId === p.id).map((o) => o.name),
			members: memberCounts.find((m) => m.projectId === p.id)?.n ?? 0
		}))
	};
};
