/**
 * Centralised authorisation. Every page, action, endpoint, search query, file download and
 * notification goes through these helpers so permission rules live in exactly one place.
 */
import { error } from '@sveltejs/kit';
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { GlobalRole, ProjectRole } from '../shared/constants';
import type { SessionUser } from './auth/session';
import { getDb, schema } from './db';
import type { Project, Ticket, TicketComment } from './db/schema';

export type Actor = Pick<SessionUser, 'id' | 'role' | 'status'> | null;

export interface ProjectAccess {
	project: Project;
	/** The actor's membership role, if any. */
	role: ProjectRole | null;
	isAdmin: boolean;
	archived: boolean;
	canView: boolean;
	/** May take part (submit, comment, vote) – before per-feature project toggles. */
	canParticipate: boolean;
	canSubmit: boolean;
	canComment: boolean;
	canVote: boolean;
	canAttach: boolean;
	/** Moderator, owner or administrator: may triage tickets and moderate discussions. */
	isStaff: boolean;
	/** Owner or administrator: may change project settings and membership. */
	isOwner: boolean;
}

function isActive(actor: Actor): actor is NonNullable<Actor> {
	return !!actor && actor.status === 'active';
}

export function isAdmin(actor: Actor): boolean {
	return isActive(actor) && actor.role === 'admin';
}

/** Pure permission computation – unit tested without a database. */
export function computeProjectAccess(
	actor: Actor,
	project: Project,
	role: ProjectRole | null
): ProjectAccess {
	const active = isActive(actor);
	const admin = active && actor.role === 'admin';
	const memberRole = active ? role : null;
	const archived = project.archivedAt !== null;
	const isPublic = project.visibility === 'public';

	const canView =
		admin ||
		memberRole !== null ||
		(isPublic && active) ||
		(isPublic && project.allowAnonymousRead);

	const isOwner = admin || memberRole === 'owner';
	const isStaff = isOwner || memberRole === 'moderator';
	const canParticipate =
		active &&
		canView &&
		!archived &&
		(isStaff || memberRole !== null || (isPublic && project.submissionPolicy === 'any_user'));

	return {
		project,
		role: memberRole,
		isAdmin: admin,
		archived,
		canView,
		canParticipate,
		canSubmit: canParticipate,
		canComment: canParticipate && (project.commentsEnabled || isStaff),
		canVote: canParticipate && project.votingEnabled,
		canAttach: canParticipate && (project.attachmentsEnabled || isStaff),
		isStaff: isStaff && active,
		isOwner: isOwner && active
	};
}

export function getMembershipRole(userId: number, projectId: number): ProjectRole | null {
	const row = getDb()
		.select({ role: schema.projectMembers.role })
		.from(schema.projectMembers)
		.where(
			and(eq(schema.projectMembers.projectId, projectId), eq(schema.projectMembers.userId, userId))
		)
		.get();
	return row?.role ?? null;
}

export function accessForProject(actor: Actor, project: Project): ProjectAccess {
	const role = isActive(actor) ? getMembershipRole(actor.id, project.id) : null;
	return computeProjectAccess(actor, project, role);
}

export function findProjectByKey(key: string): Project | undefined {
	return getDb()
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.key, key.toUpperCase()))
		.get();
}

export function findProjectById(id: number): Project | undefined {
	return getDb().select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export type ProjectNeed = 'view' | 'submit' | 'comment' | 'vote' | 'staff' | 'owner';

/** Throws an HTTP error unless the actor has the requested capability for the project. */
export function assertAccess(access: ProjectAccess | null, need: ProjectNeed, actor: Actor) {
	// Never reveal the existence of private projects to outsiders.
	if (!access || !access.canView) error(404, 'Project not found');
	const allowed =
		need === 'view' ||
		(need === 'submit' && access.canSubmit) ||
		(need === 'comment' && access.canComment) ||
		(need === 'vote' && access.canVote) ||
		(need === 'staff' && access.isStaff && !access.archived) ||
		(need === 'owner' && access.isOwner);
	if (!allowed) {
		if (!actor) error(401, 'Please sign in to continue');
		if (access.archived && need !== 'owner') error(403, 'This project is archived and read-only');
		error(403, 'You do not have permission to do that');
	}
}

export function requireProject(actor: Actor, key: string, need: ProjectNeed = 'view') {
	const project = findProjectByKey(key);
	const access = project ? accessForProject(actor, project) : null;
	assertAccess(access, need, actor);
	return access!;
}

export function requireProjectById(actor: Actor, id: number, need: ProjectNeed = 'view') {
	const project = findProjectById(id);
	const access = project ? accessForProject(actor, project) : null;
	assertAccess(access, need, actor);
	return access!;
}

/** May the actor edit the ticket's title, description and context? */
export function canEditTicket(access: ProjectAccess, actor: Actor, ticket: Ticket): boolean {
	if (!isActive(actor) || access.archived) return false;
	if (access.isStaff) return true;
	if (ticket.reporterId !== actor.id || !access.canParticipate) return false;
	const policy = access.project.editPolicy;
	return policy === 'always' || (policy === 'while_open' && ticket.status === 'open');
}

export function canEditComment(access: ProjectAccess, actor: Actor, comment: TicketComment) {
	return (
		isActive(actor) &&
		!access.archived &&
		comment.deletedAt === null &&
		comment.authorId === actor.id &&
		access.canComment
	);
}

export function canDeleteComment(access: ProjectAccess, actor: Actor, comment: TicketComment) {
	if (!isActive(actor) || access.archived || comment.deletedAt !== null) return false;
	return comment.authorId === actor.id || access.isStaff;
}

export function canCreateProjects(actor: Actor, allowUsers: boolean) {
	return isActive(actor) && (actor.role === 'admin' || allowUsers);
}

/**
 * SQL condition selecting the projects an actor may view. Used for every cross-project query
 * (search, dashboards, My Tickets) so listings can never leak private data.
 */
export function viewableProjectsCondition(actor: Actor): SQL | undefined {
	const p = schema.projects;
	if (isAdmin(actor)) return undefined;
	if (!isActive(actor)) return and(eq(p.visibility, 'public'), eq(p.allowAnonymousRead, true));
	return or(
		eq(p.visibility, 'public'),
		inArray(
			p.id,
			getDb()
				.select({ id: schema.projectMembers.projectId })
				.from(schema.projectMembers)
				.where(eq(schema.projectMembers.userId, actor.id))
		)
	);
}

/** Project ids the actor can view – convenient for IN (...) filters. */
export function viewableProjectIds(actor: Actor): number[] {
	const cond = viewableProjectsCondition(actor);
	return getDb()
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(cond ?? sql`1`)
		.all()
		.map((r) => r.id);
}

/** Can this (possibly different) user view a project? Used before notifying someone. */
export function userCanViewProject(
	user: { id: number; role: GlobalRole; status: 'active' | 'disabled' },
	project: Project,
	role: ProjectRole | null
) {
	return computeProjectAccess(user, project, role).canView;
}
