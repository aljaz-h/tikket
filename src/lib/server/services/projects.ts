import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { ProjectRole } from '../../shared/constants';
import { UNRESOLVED_STATUSES } from '../../shared/constants';
import { viewableProjectsCondition, type Actor } from '../authz';
import { getDb, schema, type DB } from '../db';
import type { Project } from '../db/schema';
import { audit } from './audit';
import { ServiceError } from './users';

export interface ProjectInput {
	name: string;
	key: string;
	description: string | null;
	icon: string | null;
	color: string;
	url: string | null;
	visibility: 'public' | 'private';
	allowAnonymousRead: boolean;
}

export interface ProjectSettingsInput extends ProjectInput {
	submissionPolicy: 'any_user' | 'members';
	votingEnabled: boolean;
	attachmentsEnabled: boolean;
	commentsEnabled: boolean;
	editPolicy: 'never' | 'while_open' | 'always';
}

function assertKeyAvailable(key: string, exceptId?: number) {
	const clash = getDb()
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(
			and(eq(schema.projects.key, key), exceptId ? ne(schema.projects.id, exceptId) : undefined)
		)
		.get();
	if (clash) throw new ServiceError('Another project already uses this key', 'key');
}

export function createProject(
	actorId: number,
	input: ProjectInput,
	ownerId: number,
	ip: string | null
): Project {
	const db = getDb();
	return db.transaction(
		(tx) => {
			assertKeyAvailable(input.key);
			const owner = tx
				.select({ id: schema.users.id, status: schema.users.status })
				.from(schema.users)
				.where(eq(schema.users.id, ownerId))
				.get();
			if (!owner || owner.status !== 'active')
				throw new ServiceError('Choose an active owner', 'ownerId');
			const project = tx
				.insert(schema.projects)
				.values({
					...input,
					allowAnonymousRead: input.visibility === 'public' && input.allowAnonymousRead,
					createdById: actorId
				})
				.returning()
				.get();
			tx.insert(schema.projectMembers)
				.values({ projectId: project.id, userId: ownerId, role: 'owner' })
				.run();
			audit(
				{
					actorId,
					action: 'project.created',
					targetType: 'project',
					targetId: project.id,
					data: { key: project.key, name: project.name, ownerId, visibility: project.visibility },
					ip
				},
				tx
			);
			return project;
		},
		{ behavior: 'immediate' }
	);
}

export function updateProject(
	actorId: number,
	project: Project,
	input: ProjectSettingsInput,
	ip: string | null
): Project {
	return getDb().transaction(
		(tx) => {
			if (input.key !== project.key) assertKeyAvailable(input.key, project.id);
			const updated = tx
				.update(schema.projects)
				.set({
					...input,
					allowAnonymousRead: input.visibility === 'public' && input.allowAnonymousRead,
					updatedAt: new Date()
				})
				.where(eq(schema.projects.id, project.id))
				.returning()
				.get();
			if (input.key !== project.key)
				audit(
					{
						actorId,
						action: 'project.key_changed',
						targetType: 'project',
						targetId: project.id,
						data: { from: project.key, to: input.key },
						ip
					},
					tx
				);
			if (
				input.visibility !== project.visibility ||
				updated.allowAnonymousRead !== project.allowAnonymousRead
			)
				audit(
					{
						actorId,
						action: 'project.visibility_changed',
						targetType: 'project',
						targetId: project.id,
						data: {
							from: project.visibility,
							to: input.visibility,
							anonymousRead: updated.allowAnonymousRead
						},
						ip
					},
					tx
				);
			audit(
				{
					actorId,
					action: 'project.updated',
					targetType: 'project',
					targetId: project.id,
					data: { key: updated.key },
					ip
				},
				tx
			);
			return updated;
		},
		{ behavior: 'immediate' }
	);
}

export function setArchived(
	actorId: number,
	project: Project,
	archived: boolean,
	ip: string | null
) {
	getDb().transaction((tx) => {
		tx.update(schema.projects)
			.set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
			.where(eq(schema.projects.id, project.id))
			.run();
		audit(
			{
				actorId,
				action: archived ? 'project.archived' : 'project.unarchived',
				targetType: 'project',
				targetId: project.id,
				data: { key: project.key },
				ip
			},
			tx
		);
	});
}

const openCount = sql<number>`(select count(*) from ${schema.tickets} t where t.project_id = ${schema.projects.id} and t.status in (${sql.join(
	UNRESOLVED_STATUSES.map((s) => sql`${s}`),
	sql`, `
)}))`;
const totalCount = sql<number>`(select count(*) from ${schema.tickets} t where t.project_id = ${schema.projects.id})`;

/** Projects visible to the actor, with their membership role and ticket counters. */
export function listProjects(actor: Actor, opts: { archived?: boolean | 'all' } = {}) {
	const db = getDb();
	const archivedCond =
		opts.archived === 'all'
			? undefined
			: opts.archived
				? isNotNull(schema.projects.archivedAt)
				: isNull(schema.projects.archivedAt);
	return db
		.select({
			id: schema.projects.id,
			key: schema.projects.key,
			name: schema.projects.name,
			description: schema.projects.description,
			icon: schema.projects.icon,
			color: schema.projects.color,
			url: schema.projects.url,
			visibility: schema.projects.visibility,
			archivedAt: schema.projects.archivedAt,
			createdAt: schema.projects.createdAt,
			role: actor ? schema.projectMembers.role : sql<null>`null`,
			openCount,
			totalCount
		})
		.from(schema.projects)
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.projectId, schema.projects.id),
				eq(schema.projectMembers.userId, actor?.id ?? -1)
			)
		)
		.where(and(viewableProjectsCondition(actor), archivedCond))
		.orderBy(asc(sql`lower(${schema.projects.name})`))
		.all();
}

export type ProjectListItem = ReturnType<typeof listProjects>[number];

export function listMembers(projectId: number) {
	return getDb()
		.select({
			id: schema.projectMembers.id,
			role: schema.projectMembers.role,
			createdAt: schema.projectMembers.createdAt,
			userId: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			email: schema.users.email,
			avatarId: schema.users.avatarId,
			status: schema.users.status
		})
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(eq(schema.projectMembers.projectId, projectId))
		.orderBy(
			sql`case ${schema.projectMembers.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`,
			asc(sql`lower(${schema.users.displayName})`)
		)
		.all();
}

/** People tickets can be assigned to: project owners/moderators and administrators. */
export function listAssignableUsers(projectId: number) {
	return getDb()
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			avatarId: schema.users.avatarId
		})
		.from(schema.users)
		.leftJoin(
			schema.projectMembers,
			and(
				eq(schema.projectMembers.userId, schema.users.id),
				eq(schema.projectMembers.projectId, projectId)
			)
		)
		.where(
			and(
				eq(schema.users.status, 'active'),
				sql`(${schema.users.role} = 'admin' or ${schema.projectMembers.role} in ('owner', 'moderator'))`
			)
		)
		.orderBy(asc(sql`lower(${schema.users.displayName})`))
		.all();
}

export function isAssignable(projectId: number, userId: number) {
	return listAssignableUsers(projectId).some((u) => u.id === userId);
}

function ownerCount(projectId: number) {
	return (
		getDb()
			.select({ n: sql<number>`count(*)` })
			.from(schema.projectMembers)
			.where(
				and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.role, 'owner'))
			)
			.get()?.n ?? 0
	);
}

export function addMember(
	actorId: number,
	project: Project,
	userId: number,
	role: ProjectRole,
	ip: string | null
) {
	getDb().transaction(
		(tx) => {
			const user = tx
				.select({ id: schema.users.id, status: schema.users.status })
				.from(schema.users)
				.where(eq(schema.users.id, userId))
				.get();
			if (!user || user.status !== 'active') throw new ServiceError('User not found', 'user');
			const existing = tx
				.select()
				.from(schema.projectMembers)
				.where(
					and(
						eq(schema.projectMembers.projectId, project.id),
						eq(schema.projectMembers.userId, userId)
					)
				)
				.get();
			if (existing) throw new ServiceError('This user is already a member', 'user');
			tx.insert(schema.projectMembers).values({ projectId: project.id, userId, role }).run();
			audit(
				{
					actorId,
					action: 'project.member_added',
					targetType: 'project',
					targetId: project.id,
					data: { userId, role },
					ip
				},
				tx
			);
		},
		{ behavior: 'immediate' }
	);
}

/** Adds or upgrades a membership (used by invitations); never downgrades an existing role. */
export function ensureMember(
	projectId: number,
	userId: number,
	role: ProjectRole,
	tx: DB = getDb()
) {
	const rank = { member: 0, moderator: 1, owner: 2 } as const;
	const existing = tx
		.select()
		.from(schema.projectMembers)
		.where(
			and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId))
		)
		.get();
	if (!existing) {
		tx.insert(schema.projectMembers).values({ projectId, userId, role }).run();
	} else if (rank[role] > rank[existing.role]) {
		tx.update(schema.projectMembers)
			.set({ role })
			.where(eq(schema.projectMembers.id, existing.id))
			.run();
	}
}

export function changeMemberRole(
	actorId: number,
	project: Project,
	userId: number,
	role: ProjectRole,
	ip: string | null
) {
	getDb().transaction(
		(tx) => {
			const existing = tx
				.select()
				.from(schema.projectMembers)
				.where(
					and(
						eq(schema.projectMembers.projectId, project.id),
						eq(schema.projectMembers.userId, userId)
					)
				)
				.get();
			if (!existing) throw new ServiceError('Member not found', 'form', 404);
			if (existing.role === role) return;
			if (existing.role === 'owner' && ownerCount(project.id) <= 1)
				throw new ServiceError('A project needs at least one owner');
			tx.update(schema.projectMembers)
				.set({ role })
				.where(eq(schema.projectMembers.id, existing.id))
				.run();
			audit(
				{
					actorId,
					action: 'project.member_role_changed',
					targetType: 'project',
					targetId: project.id,
					data: { userId, from: existing.role, to: role },
					ip
				},
				tx
			);
		},
		{ behavior: 'immediate' }
	);
}

export function removeMember(actorId: number, project: Project, userId: number, ip: string | null) {
	getDb().transaction(
		(tx) => {
			const existing = tx
				.select()
				.from(schema.projectMembers)
				.where(
					and(
						eq(schema.projectMembers.projectId, project.id),
						eq(schema.projectMembers.userId, userId)
					)
				)
				.get();
			if (!existing) throw new ServiceError('Member not found', 'form', 404);
			if (existing.role === 'owner' && ownerCount(project.id) <= 1)
				throw new ServiceError('A project needs at least one owner');
			tx.delete(schema.projectMembers).where(eq(schema.projectMembers.id, existing.id)).run();
			audit(
				{
					actorId,
					action: 'project.member_removed',
					targetType: 'project',
					targetId: project.id,
					data: { userId, role: existing.role },
					ip
				},
				tx
			);
		},
		{ behavior: 'immediate' }
	);
}

/** Staff of a project (owners and moderators) – recipients for "new ticket" notifications. */
export function projectStaffIds(projectId: number): number[] {
	return getDb()
		.select({ id: schema.projectMembers.userId })
		.from(schema.projectMembers)
		.where(
			and(
				eq(schema.projectMembers.projectId, projectId),
				inArray(schema.projectMembers.role, ['owner', 'moderator'])
			)
		)
		.all()
		.map((r) => r.id);
}

// ── Labels ───────────────────────────────────────────────────────────────

export function listLabels(projectId: number) {
	return getDb()
		.select({
			id: schema.ticketLabels.id,
			name: schema.ticketLabels.name,
			color: schema.ticketLabels.color,
			usage: sql<number>`(select count(*) from ${schema.ticketLabelAssignments} a where a.label_id = ${schema.ticketLabels.id})`
		})
		.from(schema.ticketLabels)
		.where(eq(schema.ticketLabels.projectId, projectId))
		.orderBy(asc(sql`lower(${schema.ticketLabels.name})`))
		.all();
}

export function createLabel(projectId: number, name: string, color: string) {
	const clash = getDb()
		.select({ id: schema.ticketLabels.id })
		.from(schema.ticketLabels)
		.where(
			and(
				eq(schema.ticketLabels.projectId, projectId),
				sql`lower(${schema.ticketLabels.name}) = ${name.toLowerCase()}`
			)
		)
		.get();
	if (clash) throw new ServiceError('A label with this name already exists', 'name');
	return getDb().insert(schema.ticketLabels).values({ projectId, name, color }).returning().get();
}

export function updateLabel(projectId: number, labelId: number, name: string, color: string) {
	const clash = getDb()
		.select({ id: schema.ticketLabels.id })
		.from(schema.ticketLabels)
		.where(
			and(
				eq(schema.ticketLabels.projectId, projectId),
				ne(schema.ticketLabels.id, labelId),
				sql`lower(${schema.ticketLabels.name}) = ${name.toLowerCase()}`
			)
		)
		.get();
	if (clash) throw new ServiceError('A label with this name already exists', 'name');
	return getDb()
		.update(schema.ticketLabels)
		.set({ name, color })
		.where(and(eq(schema.ticketLabels.id, labelId), eq(schema.ticketLabels.projectId, projectId)))
		.run().changes;
}

export function deleteLabel(projectId: number, labelId: number) {
	return getDb()
		.delete(schema.ticketLabels)
		.where(and(eq(schema.ticketLabels.id, labelId), eq(schema.ticketLabels.projectId, projectId)))
		.run().changes;
}
