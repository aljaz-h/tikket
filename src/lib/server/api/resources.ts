import crypto from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES,
	type TicketStatus
} from '../../shared/constants';
import { accessForProject, canViewInternalNotes, type ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Project, Ticket } from '../db/schema';
import { publicBaseUrl } from '../email/notifications';
import { normaliseRichInput } from '../sanitize';
import { audit } from '../services/audit';
import { addComment } from '../services/comments';
import { listMilestones } from '../services/milestones';
import { listReleases } from '../services/releases';
import { setTicketMilestone } from '../services/milestones';
import { setTicketRelease } from '../services/releases';
import {
	assignTicket,
	changePriority,
	changeStatus,
	createTicket,
	getTicket,
	setTicketLabels,
	updateTicketContent
} from '../services/tickets';
import { listViews } from '../services/views';
import { listRules } from '../automations/rules';
import { ApiError, encodeCursor, type ApiContext } from './http';
import type { ApiAuth } from './tokens';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const person = (username: string | null | undefined, name: string | null | undefined) =>
	username ? { username, name: name ?? username } : null;

function projectUrl(project: Pick<Project, 'key'>) {
	const base = publicBaseUrl();
	return base ? `${base}/p/${project.key.toLowerCase()}` : null;
}

export function serializeProject(project: Project, access: ProjectAccess) {
	return {
		key: project.key,
		name: project.name,
		description: project.description,
		url: projectUrl(project),
		website: project.url,
		visibility: project.visibility,
		archived: !!project.archivedAt,
		settings: {
			voting_enabled: project.votingEnabled,
			comments_enabled: project.commentsEnabled,
			attachments_enabled: project.attachmentsEnabled
		},
		permissions: {
			role: access.role,
			staff: access.isStaff,
			owner: access.isOwner,
			can_submit: access.canSubmit
		},
		created_at: iso(project.createdAt)
	};
}

/** Projects the token can reach (a project token: only its own project). */
export function listProjectsApi(auth: ApiAuth) {
	const db = getDb();
	const projects = auth.project
		? [auth.project]
		: db.select().from(schema.projects).orderBy(asc(schema.projects.key)).all();
	return projects
		.map((p) => ({ p, access: accessForProject(auth.user, p) }))
		.filter((x) => x.access.canView)
		.map((x) => serializeProject(x.p, x.access));
}

// ── Tickets ────────────────────────────────────────────────────────────────

const t = schema.tickets;

function baseTicketQuery() {
	const reporter = alias(schema.users, 'reporter');
	const assignee = alias(schema.users, 'assignee');
	return getDb()
		.select({
			t,
			reporterUsername: reporter.username,
			reporterName: reporter.displayName,
			assigneeUsername: assignee.username,
			assigneeName: assignee.displayName,
			release: { id: schema.changelogEntries.id, version: schema.changelogEntries.version },
			milestone: { id: schema.milestones.id, name: schema.milestones.name }
		})
		.from(t)
		.leftJoin(reporter, eq(reporter.id, t.reporterId))
		.leftJoin(assignee, eq(assignee.id, t.assigneeId))
		.leftJoin(schema.changelogEntries, eq(schema.changelogEntries.id, t.releaseId))
		.leftJoin(schema.milestones, eq(schema.milestones.id, t.milestoneId));
}
type TicketRow = Awaited<ReturnType<ReturnType<typeof baseTicketQuery>['all']>>[number];

function labelsFor(ids: number[]) {
	if (!ids.length) return new Map<number, string[]>();
	const rows = getDb()
		.select({ ticketId: schema.ticketLabelAssignments.ticketId, name: schema.ticketLabels.name })
		.from(schema.ticketLabelAssignments)
		.innerJoin(
			schema.ticketLabels,
			eq(schema.ticketLabels.id, schema.ticketLabelAssignments.labelId)
		)
		.where(inArray(schema.ticketLabelAssignments.ticketId, ids))
		.orderBy(asc(schema.ticketLabels.name))
		.all();
	const map = new Map<number, string[]>();
	for (const r of rows) map.set(r.ticketId, [...(map.get(r.ticketId) ?? []), r.name]);
	return map;
}

function serializeTicket(row: TicketRow, access: ProjectAccess, labels: string[], full = false) {
	const x = row.t;
	const key = access.project.key;
	const url = projectUrl(access.project);
	return {
		key: `${key}-${x.number}`,
		number: x.number,
		url: url ? `${url}/tickets/${x.number}` : null,
		type: x.type,
		title: x.title,
		status: x.status,
		priority: x.priority,
		reporter: person(row.reporterUsername, row.reporterName),
		assignee: person(row.assigneeUsername, row.assigneeName),
		labels,
		votes: x.voteCount,
		comment_count: x.commentCount,
		source: x.source,
		external_ref: x.externalRef,
		// Planning data is staff-only, as in the web app.
		...(access.isStaff
			? {
					release: row.release?.id ? { id: row.release.id, version: row.release.version } : null,
					milestone: row.milestone?.id ? { id: row.milestone.id, name: row.milestone.name } : null
				}
			: {}),
		created_at: iso(x.createdAt),
		updated_at: iso(x.updatedAt),
		completed_at: iso(x.completedAt),
		...(full
			? {
					description_html: x.descriptionHtml,
					description_text: x.descriptionText,
					details: x.context,
					resolution_note: x.resolutionNote
				}
			: {})
	};
}

const csv = (v: string | null) =>
	v
		? v
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: [];
const isoDate = (v: string | null, name: string) => {
	if (!v) return null;
	const d = new Date(v);
	if (Number.isNaN(d.getTime()))
		throw new ApiError(400, 'invalid_filter', `${name} must be an ISO 8601 date`);
	return d;
};
function oneOf<T extends string>(values: string[], allowed: readonly T[], name: string): T[] {
	const bad = values.filter((v) => !allowed.includes(v as T));
	if (bad.length) throw new ApiError(400, 'invalid_filter', `Unknown ${name}: ${bad.join(', ')}`);
	return values as T[];
}
function userIdByName(username: string) {
	return getDb()
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(sql`lower(${schema.users.username}) = ${username.toLowerCase()}`)
		.get()?.id;
}

/** Ticket list with validated filters and keyset (cursor) pagination, newest first. */
export function listTicketsApi(
	access: ProjectAccess,
	url: URL,
	page: { limit: number; before: number | null }
) {
	const q = url.searchParams;
	const where: (SQL | undefined)[] = [eq(t.projectId, access.project.id)];
	const statuses = oneOf(csv(q.get('status')), TICKET_STATUSES, 'status');
	if (statuses.length) where.push(inArray(t.status, statuses));
	const types = oneOf(csv(q.get('type')), TICKET_TYPES, 'type');
	if (types.length) where.push(inArray(t.type, types));
	const priorities = oneOf(csv(q.get('priority')), TICKET_PRIORITIES, 'priority');
	if (priorities.length) where.push(inArray(t.priority, priorities));
	const assignee = q.get('assignee');
	if (assignee)
		where.push(
			assignee === 'none' ? isNull(t.assigneeId) : eq(t.assigneeId, userIdByName(assignee) ?? -1)
		);
	const reporter = q.get('reporter');
	if (reporter) where.push(eq(t.reporterId, userIdByName(reporter) ?? -1));
	const label = q.get('label');
	if (label)
		where.push(
			sql`exists (select 1 from ${schema.ticketLabelAssignments} la join ${schema.ticketLabels} l on l.id = la.label_id where la.ticket_id = ${t.id} and lower(l.name) = ${label.toLowerCase()})`
		);
	for (const [param, column] of [
		['milestone', t.milestoneId],
		['release', t.releaseId]
	] as const) {
		const value = q.get(param);
		if (!value) continue;
		if (!access.isStaff)
			throw new ApiError(
				403,
				'forbidden',
				'Release and milestone filters are available to project staff'
			);
		if (value === 'none') where.push(isNull(column));
		else if (/^\d+$/.test(value)) where.push(eq(column, Number(value)));
		else throw new ApiError(400, 'invalid_filter', `${param} must be an id or "none"`);
	}
	const updatedAfter = isoDate(q.get('updated_after'), 'updated_after');
	if (updatedAfter) where.push(gt(t.updatedAt, updatedAfter));
	const createdAfter = isoDate(q.get('created_after'), 'created_after');
	if (createdAfter) where.push(gt(t.createdAt, createdAfter));
	if (page.before) where.push(lt(t.id, page.before));
	const rows = baseTicketQuery()
		.where(and(...where))
		.orderBy(desc(t.id))
		.limit(page.limit + 1)
		.all();
	const items = rows.slice(0, page.limit);
	const labels = labelsFor(items.map((r) => r.t.id));
	return {
		data: items.map((r) => serializeTicket(r, access, labels.get(r.t.id) ?? [])),
		meta: {
			count: items.length,
			limit: page.limit,
			next_cursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].t.id) : null
		}
	};
}

export function requireTicket(access: ProjectAccess, raw: string): Ticket {
	const number = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
	const ticket = Number.isInteger(number) ? getTicket(access.project.id, number) : undefined;
	if (!ticket) throw new ApiError(404, 'ticket_not_found', 'Ticket not found');
	return ticket;
}

export function ticketApi(access: ProjectAccess, ticket: Ticket) {
	const row = baseTicketQuery().where(eq(t.id, ticket.id)).get()!;
	return serializeTicket(row, access, labelsFor([ticket.id]).get(ticket.id) ?? [], true);
}

const createSchema = z
	.object({
		title: z.string().trim().min(3, 'title must be at least 3 characters').max(200),
		description: z.string().max(50_000).optional(),
		description_html: z.string().max(100_000).optional(),
		type: z.enum(TICKET_TYPES).default('bug')
	})
	.strict();

function fingerprint(body: unknown) {
	return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/** POST tickets, with optional Idempotency-Key (24 h): a repeat returns the original response. */
export function createTicketApi(ctx: ApiContext, access: ProjectAccess, body: unknown) {
	const key = ctx.event.request.headers.get('idempotency-key');
	let recordId: string | null = null;
	if (key !== null) {
		if (!/^[\x21-\x7e]{1,200}$/.test(key))
			throw new ApiError(
				400,
				'invalid_idempotency_key',
				'Idempotency-Key must be 1–200 visible ASCII characters'
			);
		recordId = crypto
			.createHash('sha256')
			.update(`${ctx.auth.tokenId}:${access.project.id}:${key}`)
			.digest('hex');
		const existing = getDb()
			.select()
			.from(schema.apiIdempotency)
			.where(eq(schema.apiIdempotency.id, recordId))
			.get();
		if (existing) {
			if (existing.fingerprint !== fingerprint(body))
				throw new ApiError(
					422,
					'idempotency_key_reused',
					'This Idempotency-Key was already used with a different request'
				);
			ctx.headers.set('idempotent-replayed', 'true');
			return { status: existing.statusCode, body: existing.response };
		}
	}
	const input = createSchema.parse(body);
	const rich =
		input.description_html !== undefined
			? normaliseRichInput(input.description_html, 'html')
			: normaliseRichInput(input.description ?? '', 'text');
	if (!rich.text.trim())
		throw new ApiError(422, 'validation_failed', 'description is required', {
			field: 'description'
		});
	const ticket = createTicket(
		ctx.auth.user,
		access,
		{
			type: input.type,
			title: input.title,
			descriptionHtml: rich.html,
			descriptionText: rich.text,
			context: {}
		},
		[],
		{ source: 'api' }
	);
	audit({
		actorId: ctx.auth.user.id,
		action: 'api.ticket_created',
		targetType: 'ticket',
		targetId: ticket.id,
		data: {
			project: access.project.key,
			number: ticket.number,
			token: ctx.auth.prefix,
			tokenId: ctx.auth.tokenId
		},
		ip: ctx.event.locals.clientIp
	});
	const response = { data: ticketApi(access, ticket), meta: {} };
	if (recordId)
		getDb()
			.insert(schema.apiIdempotency)
			.values({ id: recordId, fingerprint: fingerprint(body), statusCode: 201, response })
			.onConflictDoNothing()
			.run();
	return { status: 201, body: response };
}

const patchSchema = z
	.object({
		title: z.string().trim().min(3).max(200).optional(),
		description: z.string().max(50_000).optional(),
		description_html: z.string().max(100_000).optional(),
		type: z.enum(TICKET_TYPES).optional(),
		status: z.enum(TICKET_STATUSES).optional(),
		status_note: z.string().trim().max(2000).nullable().optional(),
		duplicate_of: z.string().max(20).optional(),
		priority: z.enum(TICKET_PRIORITIES).optional(),
		assignee: z.string().max(60).nullable().optional(),
		labels: z.array(z.string().max(60)).max(30).optional(),
		milestone_id: z.number().int().positive().nullable().optional(),
		release_id: z.number().int().positive().nullable().optional()
	})
	.strict();

/**
 * PATCH a ticket. Every change goes through the same service (and permission checks) as the
 * web app, in a fixed order; the response is the updated ticket.
 */
export function patchTicketApi(
	ctx: ApiContext,
	access: ProjectAccess,
	ticket: Ticket,
	body: unknown
) {
	const input = patchSchema.parse(body);
	const actor = ctx.auth.user;
	const fields = Object.keys(input);
	if (!fields.length) throw new ApiError(422, 'validation_failed', 'Nothing to update');
	const fresh = () => getTicket(access.project.id, ticket.number)!;
	// All-or-nothing: a rejected change (e.g. a disallowed transition) rolls back the earlier ones.
	getDb().transaction(() => applyPatch(actor, access, fresh, input));
	audit({
		actorId: actor.id,
		action: 'api.ticket_updated',
		targetType: 'ticket',
		targetId: ticket.id,
		data: {
			project: access.project.key,
			number: ticket.number,
			fields,
			token: ctx.auth.prefix,
			tokenId: ctx.auth.tokenId
		},
		ip: ctx.event.locals.clientIp
	});
	return ticketApi(access, fresh());
}

function applyPatch(
	actor: ApiAuth['user'],
	access: ProjectAccess,
	fresh: () => Ticket,
	input: z.infer<typeof patchSchema>
) {
	if (
		input.title !== undefined ||
		input.description !== undefined ||
		input.description_html !== undefined ||
		input.type !== undefined
	) {
		const current = fresh();
		const rich =
			input.description_html !== undefined
				? normaliseRichInput(input.description_html, 'html')
				: input.description !== undefined
					? normaliseRichInput(input.description, 'text')
					: { html: current.descriptionHtml, text: current.descriptionText };
		updateTicketContent(actor, access, current, {
			title: input.title ?? current.title,
			type: input.type ?? current.type,
			descriptionHtml: rich.html,
			descriptionText: rich.text,
			context: current.context
		});
	}
	if (input.status !== undefined && input.status !== fresh().status)
		changeStatus(actor, access, fresh(), {
			status: input.status as TicketStatus,
			note: input.status_note ?? null,
			duplicateOf: input.duplicate_of
		});
	if (input.priority !== undefined) changePriority(actor, access, fresh(), input.priority);
	if (input.assignee !== undefined) {
		const id = input.assignee === null ? null : userIdByName(input.assignee);
		if (input.assignee !== null && !id)
			throw new ApiError(422, 'validation_failed', 'Unknown assignee', { field: 'assignee' });
		assignTicket(actor, access, fresh(), id ?? null);
	}
	if (input.labels !== undefined) {
		const all = getDb()
			.select({ id: schema.ticketLabels.id, name: schema.ticketLabels.name })
			.from(schema.ticketLabels)
			.where(eq(schema.ticketLabels.projectId, access.project.id))
			.all();
		const ids = input.labels.map((name) => {
			const found = all.find((l) => l.name.toLowerCase() === name.toLowerCase());
			if (!found)
				throw new ApiError(422, 'validation_failed', `Unknown label: ${name}`, { field: 'labels' });
			return found.id;
		});
		setTicketLabels(actor, access, fresh(), ids);
	}
	if (input.milestone_id !== undefined)
		setTicketMilestone(actor, access, fresh(), input.milestone_id);
	if (input.release_id !== undefined) setTicketRelease(actor, access, fresh(), input.release_id);
}

// ── Comments ───────────────────────────────────────────────────────────────

export function listCommentsApi(
	access: ProjectAccess,
	ticket: Ticket,
	page: { limit: number; before: number | null }
) {
	const staff = canViewInternalNotes(access);
	const c = schema.ticketComments;
	const rows = getDb()
		.select({ c, username: schema.users.username, name: schema.users.displayName })
		.from(c)
		.innerJoin(schema.users, eq(schema.users.id, c.authorId))
		.where(
			and(
				eq(c.ticketId, ticket.id),
				staff ? undefined : eq(c.internal, false),
				page.before ? lt(c.id, page.before) : undefined
			)
		)
		.orderBy(desc(c.id))
		.limit(page.limit + 1)
		.all();
	const items = rows.slice(0, page.limit);
	return {
		data: items.map(({ c: x, username, name }) => {
			const automation = (x.meta?.automation as { name?: string } | undefined)?.name;
			const imported = (x.meta?.imported as { author?: string } | undefined)?.author;
			return {
				id: x.id,
				author: automation
					? { username: null, name: `Automation: ${automation}` }
					: imported
						? { username: null, name: imported }
						: person(username, name),
				automated: !!automation,
				...(staff ? { internal: x.internal } : {}),
				body_html: x.deletedAt ? null : x.bodyHtml,
				body_text: x.deletedAt ? null : x.bodyText,
				deleted: !!x.deletedAt,
				created_at: iso(x.createdAt),
				edited_at: iso(x.editedAt)
			};
		}),
		meta: {
			count: items.length,
			limit: page.limit,
			next_cursor: rows.length > page.limit ? encodeCursor(items[items.length - 1].c.id) : null
		}
	};
}

const commentSchema = z
	.object({
		body: z.string().max(50_000).optional(),
		body_html: z.string().max(100_000).optional(),
		internal: z.boolean().default(false)
	})
	.strict();

export function createCommentApi(
	ctx: ApiContext,
	access: ProjectAccess,
	ticket: Ticket,
	body: unknown
) {
	const input = commentSchema.parse(body);
	const rich =
		input.body_html !== undefined
			? normaliseRichInput(input.body_html, 'html')
			: normaliseRichInput(input.body ?? '', 'text');
	const comment = addComment(ctx.auth.user, access, ticket, rich, [], { internal: input.internal });
	audit({
		actorId: ctx.auth.user.id,
		action: 'api.comment_created',
		targetType: 'ticket',
		targetId: ticket.id,
		data: {
			project: access.project.key,
			number: ticket.number,
			commentId: comment.id,
			internal: input.internal,
			token: ctx.auth.prefix,
			tokenId: ctx.auth.tokenId
		},
		ip: ctx.event.locals.clientIp
	});
	return {
		id: comment.id,
		author: { username: ctx.auth.user.username, name: ctx.auth.user.displayName },
		automated: false,
		...(canViewInternalNotes(access) ? { internal: comment.internal } : {}),
		body_html: comment.bodyHtml,
		body_text: comment.bodyText,
		deleted: false,
		created_at: iso(comment.createdAt),
		edited_at: null
	};
}

// ── Project metadata ───────────────────────────────────────────────────────

export function labelsApi(access: ProjectAccess) {
	return getDb()
		.select({
			id: schema.ticketLabels.id,
			name: schema.ticketLabels.name,
			color: schema.ticketLabels.color
		})
		.from(schema.ticketLabels)
		.where(eq(schema.ticketLabels.projectId, access.project.id))
		.orderBy(asc(schema.ticketLabels.name))
		.all();
}

/** Releases: staff see planned ones too; everyone else only published releases (the changelog). */
export function releasesApi(access: ProjectAccess) {
	return listReleases(access.project.id, access.isStaff ? {} : { statuses: ['released'] }).map(
		(r) => ({
			id: r.id,
			version: r.version,
			status: r.status,
			...(access.isStaff ? { target_date: r.targetDate } : {}),
			released_at: iso(r.releasedAt),
			progress: { total: r.progress.total, completed: r.progress.completed }
		})
	);
}

export function milestonesApi(access: ProjectAccess) {
	if (!access.isStaff)
		throw new ApiError(403, 'forbidden', 'Milestones are available to project staff');
	return listMilestones(access.project.id).map((m) => ({
		id: m.id,
		name: m.name,
		description: m.description,
		status: m.status,
		target_date: m.targetDate,
		completed_at: iso(m.completedAt),
		progress: { total: m.progress.total, completed: m.progress.completed }
	}));
}

/** Project members (staff only – member lists are not public). Never email addresses. */
export function membersApi(access: ProjectAccess) {
	if (!access.isStaff)
		throw new ApiError(403, 'forbidden', 'The member list is available to project staff');
	return getDb()
		.select({
			username: schema.users.username,
			name: schema.users.displayName,
			role: schema.projectMembers.role
		})
		.from(schema.projectMembers)
		.innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
		.where(
			and(eq(schema.projectMembers.projectId, access.project.id), eq(schema.users.status, 'active'))
		)
		.orderBy(asc(schema.users.username))
		.all();
}

export function viewsApi(auth: ApiAuth, access: ProjectAccess) {
	return listViews(auth.user, access).map((v) => ({
		id: v.id,
		name: v.name,
		shared: v.shared,
		query: v.query,
		columns: v.columns
	}));
}

/** Automation metadata (no secrets; hook destinations are referenced by id only). */
export function automationsApi(access: ProjectAccess) {
	if (!access.isStaff)
		throw new ApiError(403, 'forbidden', 'Automations are available to project staff');
	return listRules(access.project.id).map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		enabled: r.enabled,
		trigger: r.trigger,
		trigger_config: r.triggerConfig,
		conditions: r.conditions,
		actions: r.actions,
		run_count: r.runCount,
		last_run_at: iso(r.lastRunAt),
		last_error: r.lastError
	}));
}

/** Removes idempotency records older than 24 hours. */
export function pruneIdempotency(now = Date.now()) {
	return getDb()
		.delete(schema.apiIdempotency)
		.where(lt(schema.apiIdempotency.createdAt, new Date(now - 864e5)))
		.run().changes;
}
