import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, type DB } from '../db';

export type ProjectSubject = 'release' | 'milestone' | 'view';

/** Records a change to a project-level object (release, milestone, shared view). */
export function addProjectActivity(
	tx: DB,
	projectId: number,
	actorId: number | null,
	subjectType: ProjectSubject,
	subjectId: number,
	type: string,
	data: Record<string, unknown> = {}
) {
	tx.insert(schema.projectActivity)
		.values({ projectId, actorId, subjectType, subjectId, type, data })
		.run();
}

export function listProjectActivity(
	projectId: number,
	subjectType: ProjectSubject,
	subjectId: number,
	limit = 50
) {
	return getDb()
		.select({
			id: schema.projectActivity.id,
			type: schema.projectActivity.type,
			data: schema.projectActivity.data,
			createdAt: schema.projectActivity.createdAt,
			actorName: schema.users.displayName
		})
		.from(schema.projectActivity)
		.leftJoin(schema.users, eq(schema.users.id, schema.projectActivity.actorId))
		.where(
			and(
				eq(schema.projectActivity.projectId, projectId),
				eq(schema.projectActivity.subjectType, subjectType),
				eq(schema.projectActivity.subjectId, subjectId)
			)
		)
		.orderBy(desc(schema.projectActivity.createdAt), desc(schema.projectActivity.id))
		.limit(limit)
		.all();
}
