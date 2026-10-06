import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { TICKET_COLUMNS, type TicketColumn } from '../../shared/constants';
import { normaliseViewQuery } from '../../shared/filters';
import type { Actor, ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { SavedView } from '../db/schema';
import { addProjectActivity } from './project-activity';
import { ServiceError } from './users';

type ActiveActor = NonNullable<Actor>;
const v = schema.savedViews;
const MAX_VIEWS = 50;

export interface ViewInput {
	name: string;
	query: string;
	columns: string[];
	shared: boolean;
}

export interface ClientView {
	id: number;
	name: string;
	query: string;
	columns: TicketColumn[];
	shared: boolean;
	/** Whether the current user may rename, edit, reorder or delete it. */
	canManage: boolean;
}

/** May the actor manage this view? Personal: its owner. Shared: active project staff. */
export function canManageView(actor: Actor, access: ProjectAccess, view: SavedView) {
	if (!actor || actor.status !== 'active') return false;
	if (view.ownerId === null) return access.isStaff && !access.archived;
	return view.ownerId === actor.id;
}

function toClient(actor: Actor, access: ProjectAccess, view: SavedView): ClientView {
	return {
		id: view.id,
		name: view.name,
		query: view.definition.query,
		columns: view.definition.columns,
		shared: view.ownerId === null,
		canManage: canManageView(actor, access, view)
	};
}

/** Shared views of the project plus the actor's own personal views, in their saved order. */
export function listViews(actor: Actor, access: ProjectAccess): ClientView[] {
	if (!access.canView) return [];
	return getDb()
		.select()
		.from(v)
		.where(
			and(
				eq(v.projectId, access.project.id),
				actor ? or(isNull(v.ownerId), eq(v.ownerId, actor.id)) : isNull(v.ownerId)
			)
		)
		.orderBy(sql`${v.ownerId} is not null`, asc(v.position), asc(v.id))
		.all()
		.map((view) => toClient(actor, access, view));
}

/** A view the actor may see (personal views of others are invisible – 404). */
export function getView(actor: Actor, access: ProjectAccess, id: number): SavedView {
	const view = getDb()
		.select()
		.from(v)
		.where(and(eq(v.id, id), eq(v.projectId, access.project.id)))
		.get();
	if (!view || (view.ownerId !== null && view.ownerId !== actor?.id))
		throw new ServiceError('View not found', 'view', 404);
	return view;
}

/**
 * Validates a definition: the query is re-parsed and re-serialised, so only known filters are
 * stored (never SQL or arbitrary text), and unknown columns are dropped.
 */
function definition(input: Pick<ViewInput, 'query' | 'columns'>) {
	const columns = [...new Set(input.columns)].filter((c): c is TicketColumn =>
		(TICKET_COLUMNS as readonly string[]).includes(c)
	);
	return { query: normaliseViewQuery(input.query.replace(/^\?/, '')), columns };
}

function validName(name: string) {
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 60)
		throw new ServiceError('Name the view (up to 60 characters)', 'name');
	return trimmed;
}

export function createView(actor: ActiveActor, access: ProjectAccess, input: ViewInput) {
	if (!access.canView) throw new ServiceError('Project not found', 'form', 404);
	if (input.shared && (!access.isStaff || access.archived))
		throw new ServiceError('Only project staff can create shared views', 'shared', 403);
	const name = validName(input.name);
	const ownerId = input.shared ? null : actor.id;
	const db = getDb();
	return db.transaction((tx) => {
		const scope = and(
			eq(v.projectId, access.project.id),
			ownerId === null ? isNull(v.ownerId) : eq(v.ownerId, ownerId)
		);
		const count =
			tx
				.select({ n: sql<number>`count(*)` })
				.from(v)
				.where(scope)
				.get()?.n ?? 0;
		if (count >= MAX_VIEWS)
			throw new ServiceError(`You can keep up to ${MAX_VIEWS} views here`, 'name');
		const row = tx
			.insert(v)
			.values({
				projectId: access.project.id,
				ownerId,
				createdById: actor.id,
				name,
				definition: definition(input),
				position: count
			})
			.returning()
			.get();
		if (ownerId === null)
			addProjectActivity(tx, access.project.id, actor.id, 'view', row.id, 'created', { name });
		return toClient(actor, access, row);
	});
}

export function updateView(
	actor: ActiveActor,
	access: ProjectAccess,
	id: number,
	input: Partial<Pick<ViewInput, 'name' | 'query' | 'columns'>>
) {
	const view = getView(actor, access, id);
	if (!canManageView(actor, access, view))
		throw new ServiceError('You cannot change this view', 'form', 403);
	const name = input.name !== undefined ? validName(input.name) : view.name;
	const def =
		input.query !== undefined || input.columns !== undefined
			? definition({
					query: input.query ?? view.definition.query,
					columns: input.columns ?? view.definition.columns
				})
			: view.definition;
	getDb().transaction((tx) => {
		tx.update(v).set({ name, definition: def, updatedAt: new Date() }).where(eq(v.id, id)).run();
		if (view.ownerId === null) {
			if (name !== view.name)
				addProjectActivity(tx, access.project.id, actor.id, 'view', id, 'renamed', {
					from: view.name,
					to: name
				});
			if (JSON.stringify(def) !== JSON.stringify(view.definition))
				addProjectActivity(tx, access.project.id, actor.id, 'view', id, 'edited', {
					fields: ['filters']
				});
		}
	});
}

/** Copies any visible view into a new personal view (or a shared one, for staff). */
export function duplicateView(
	actor: ActiveActor,
	access: ProjectAccess,
	id: number,
	opts: { shared?: boolean } = {}
) {
	const view = getView(actor, access, id);
	return createView(actor, access, {
		name: `${view.name} (copy)`.slice(0, 60),
		query: view.definition.query,
		columns: view.definition.columns,
		shared: !!opts.shared
	});
}

export function deleteView(actor: ActiveActor, access: ProjectAccess, id: number) {
	const view = getView(actor, access, id);
	if (!canManageView(actor, access, view))
		throw new ServiceError('You cannot delete this view', 'form', 403);
	getDb().transaction((tx) => {
		tx.delete(v).where(eq(v.id, id)).run();
		if (view.ownerId === null)
			addProjectActivity(tx, access.project.id, actor.id, 'view', id, 'deleted', {
				name: view.name
			});
	});
}

/** Moves a view one step up or down within its own list (shared or personal). */
export function moveView(actor: ActiveActor, access: ProjectAccess, id: number, delta: -1 | 1) {
	const view = getView(actor, access, id);
	if (!canManageView(actor, access, view))
		throw new ServiceError('You cannot reorder this view', 'form', 403);
	getDb().transaction((tx) => {
		const siblings = tx
			.select({ id: v.id })
			.from(v)
			.where(
				and(
					eq(v.projectId, access.project.id),
					view.ownerId === null ? isNull(v.ownerId) : eq(v.ownerId, view.ownerId)
				)
			)
			.orderBy(asc(v.position), asc(v.id))
			.all()
			.map((s) => s.id);
		const i = siblings.indexOf(id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= siblings.length) return;
		[siblings[i], siblings[j]] = [siblings[j], siblings[i]];
		siblings.forEach((sid, position) => tx.update(v).set({ position }).where(eq(v.id, sid)).run());
	});
}
