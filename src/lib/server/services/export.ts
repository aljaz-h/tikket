import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { ProjectAccess } from '../authz';
import { viewableProjectIds } from '../authz';
import { getDb, schema } from '../db';
import type { Project } from '../db/schema';
import { publicBaseUrl } from '../email/notifications';
import { audit } from './audit';
import { ServiceError } from './users';

/**
 * Data export.
 *
 * - Project export (JSON, format "tikket-project" version 1) and a ticket CSV, for project owners
 *   and administrators. The "staff" scope additionally contains internal notes and voter names
 *   and is clearly labelled as such.
 * - Personal export of a user's own submissions and comments.
 *
 * Exports never contain password hashes, sessions, tokens, integration secrets, email
 * addresses or uploaded files (attachments are listed by name only). Tickets are read in pages
 * and streamed, so large projects are never held in memory at once.
 */

export const EXPORT_FORMAT = 'tikket-project';
export const EXPORT_VERSION = 1;
export type ExportScope = 'standard' | 'staff';
const PAGE = 100;

export function requireExporter(access: ProjectAccess) {
	if (!access.isOwner)
		throw new ServiceError('Only project owners can export project data', 'form', 403);
}

export function recordExport(
	actorId: number,
	project: Project,
	format: 'json' | 'csv' | 'bundle',
	scope: ExportScope,
	ip: string | null
) {
	audit({
		actorId,
		action: 'project.exported',
		targetType: 'project',
		targetId: project.id,
		data: { format, scope },
		ip
	});
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const person = (username: string | null | undefined, name: string | null | undefined) =>
	username ? { username, name: name ?? username } : null;

function ticketUrl(project: Project, number: number) {
	const base = publicBaseUrl();
	return base ? `${base}/p/${project.key.toLowerCase()}/tickets/${number}` : null;
}

/** One page of tickets with everything that belongs to them, ordered by id. */
function ticketPage(project: Project, afterId: number, scope: ExportScope) {
	const db = getDb();
	const t = schema.tickets;
	const reporter = alias(schema.users, 'reporter');
	const assignee = alias(schema.users, 'assignee');
	const dup = alias(schema.tickets, 'dup');
	const rows = db
		.select({
			t,
			reporterUsername: reporter.username,
			reporterName: reporter.displayName,
			assigneeUsername: assignee.username,
			assigneeName: assignee.displayName,
			release: schema.changelogEntries.version,
			milestone: schema.milestones.name,
			duplicateOf: dup.number
		})
		.from(t)
		.leftJoin(reporter, eq(reporter.id, t.reporterId))
		.leftJoin(assignee, eq(assignee.id, t.assigneeId))
		.leftJoin(schema.changelogEntries, eq(schema.changelogEntries.id, t.releaseId))
		.leftJoin(schema.milestones, eq(schema.milestones.id, t.milestoneId))
		.leftJoin(dup, eq(dup.id, t.duplicateOfId))
		.where(and(eq(t.projectId, project.id), gt(t.id, afterId)))
		.orderBy(asc(t.id))
		.limit(PAGE)
		.all();
	if (!rows.length) return { tickets: [], lastId: afterId };
	const ids = rows.map((r) => r.t.id);
	const labels = db
		.select({ ticketId: schema.ticketLabelAssignments.ticketId, name: schema.ticketLabels.name })
		.from(schema.ticketLabelAssignments)
		.innerJoin(
			schema.ticketLabels,
			eq(schema.ticketLabels.id, schema.ticketLabelAssignments.labelId)
		)
		.where(inArray(schema.ticketLabelAssignments.ticketId, ids))
		.all();
	const author = alias(schema.users, 'author');
	const comments = db
		.select({
			c: schema.ticketComments,
			authorUsername: author.username,
			authorName: author.displayName
		})
		.from(schema.ticketComments)
		.leftJoin(author, eq(author.id, schema.ticketComments.authorId))
		.where(
			and(
				inArray(schema.ticketComments.ticketId, ids),
				// Internal notes only in the staff export.
				scope === 'staff' ? undefined : eq(schema.ticketComments.internal, false)
			)
		)
		.orderBy(asc(schema.ticketComments.id))
		.all();
	const actor = alias(schema.users, 'actor');
	const activity = db
		.select({
			a: schema.ticketActivity,
			actorUsername: actor.username,
			actorName: actor.displayName
		})
		.from(schema.ticketActivity)
		.leftJoin(actor, eq(actor.id, schema.ticketActivity.actorId))
		.where(inArray(schema.ticketActivity.ticketId, ids))
		.orderBy(asc(schema.ticketActivity.id))
		.all();
	const target = alias(schema.tickets, 'target');
	const source = alias(schema.tickets, 'source');
	const relations = db
		.select({
			sourceId: schema.ticketRelationships.sourceTicketId,
			targetId: schema.ticketRelationships.targetTicketId,
			kind: schema.ticketRelationships.kind,
			sourceNumber: source.number,
			targetNumber: target.number
		})
		.from(schema.ticketRelationships)
		.innerJoin(source, eq(source.id, schema.ticketRelationships.sourceTicketId))
		.innerJoin(target, eq(target.id, schema.ticketRelationships.targetTicketId))
		.where(
			or(
				inArray(schema.ticketRelationships.sourceTicketId, ids),
				inArray(schema.ticketRelationships.targetTicketId, ids)
			)
		)
		.all();
	const answers = db
		.select()
		.from(schema.ticketTemplateResponses)
		.where(inArray(schema.ticketTemplateResponses.ticketId, ids))
		.all();
	const attachments = db
		.select({
			ticketId: schema.attachments.ticketId,
			commentId: schema.attachments.commentId,
			id: schema.attachments.id,
			name: schema.attachments.originalName,
			mimeType: schema.attachments.mimeType,
			size: schema.attachments.size
		})
		.from(schema.attachments)
		.where(and(inArray(schema.attachments.ticketId, ids), isNull(schema.attachments.deletedAt)))
		.all();
	const voter = alias(schema.users, 'voter');
	const voters =
		scope === 'staff'
			? db
					.select({ ticketId: schema.ticketVotes.ticketId, username: voter.username })
					.from(schema.ticketVotes)
					.innerJoin(voter, eq(voter.id, schema.ticketVotes.userId))
					.where(inArray(schema.ticketVotes.ticketId, ids))
					.all()
			: [];
	const internalCommentIds = new Set(comments.filter((c) => c.c.internal).map((c) => c.c.id));
	const by = <T, K>(list: T[], key: (x: T) => K) => {
		const map = new Map<K, T[]>();
		for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
		return map;
	};
	const labelsBy = by(labels, (x) => x.ticketId);
	const commentsBy = by(comments, (x) => x.c.ticketId);
	const activityBy = by(activity, (x) => x.a.ticketId);
	const answersBy = new Map(answers.map((x) => [x.ticketId, x]));
	const attachmentsBy = by(
		attachments.filter(
			(x) => !x.commentId || scope === 'staff' || !internalCommentIds.has(x.commentId)
		),
		(x) => x.ticketId
	);
	const votersBy = by(voters, (x) => x.ticketId);
	const key = project.key;
	const tickets = rows.map(({ t: x, ...r }) => {
		const tpl = answersBy.get(x.id);
		return {
			id: x.id,
			key: `${key}-${x.number}`,
			number: x.number,
			url: ticketUrl(project, x.number),
			type: x.type,
			title: x.title,
			description_html: x.descriptionHtml,
			description_text: x.descriptionText,
			details: x.context,
			status: x.status,
			priority: x.priority,
			resolution_note: x.resolutionNote,
			duplicate_of: r.duplicateOf ? `${key}-${r.duplicateOf}` : null,
			source: x.source,
			environment: x.environment,
			reporter: person(r.reporterUsername, r.reporterName),
			assignee: person(r.assigneeUsername, r.assigneeName),
			labels: (labelsBy.get(x.id) ?? []).map((l) => l.name),
			release: r.release,
			milestone: r.milestone,
			votes: x.voteCount,
			...(scope === 'staff' ? { voters: (votersBy.get(x.id) ?? []).map((v) => v.username) } : {}),
			created_at: iso(x.createdAt),
			updated_at: iso(x.updatedAt),
			completed_at: iso(x.completedAt),
			closed_at: iso(x.closedAt),
			template: tpl
				? {
						name: tpl.templateName,
						version: tpl.templateVersion,
						answers: tpl.answers
					}
				: null,
			relationships: relations
				.filter((rel) => rel.sourceId === x.id || rel.targetId === x.id)
				.map((rel) =>
					rel.kind === 'relates'
						? {
								kind: 'relates',
								ticket: `${key}-${rel.sourceId === x.id ? rel.targetNumber : rel.sourceNumber}`
							}
						: rel.sourceId === x.id
							? { kind: 'blocks', ticket: `${key}-${rel.targetNumber}` }
							: { kind: 'blocked_by', ticket: `${key}-${rel.sourceNumber}` }
				),
			attachments: (attachmentsBy.get(x.id) ?? []).map((a) => ({
				id: a.id,
				name: a.name,
				mime_type: a.mimeType,
				size: a.size,
				comment_id: a.commentId
			})),
			comments: (commentsBy.get(x.id) ?? []).map(({ c, authorUsername, authorName }) => ({
				id: c.id,
				author: person(authorUsername, authorName),
				...(scope === 'staff' ? { internal: c.internal } : {}),
				body_html: c.deletedAt ? null : c.bodyHtml,
				body_text: c.deletedAt ? null : c.bodyText,
				deleted: !!c.deletedAt,
				created_at: iso(c.createdAt),
				edited_at: iso(c.editedAt)
			})),
			activity: (activityBy.get(x.id) ?? []).map(({ a, actorUsername, actorName }) => ({
				type: a.type,
				actor: person(actorUsername, actorName),
				data: a.data,
				created_at: iso(a.createdAt)
			}))
		};
	});
	return { tickets, lastId: rows[rows.length - 1].t.id };
}

function projectHeader(project: Project, scope: ExportScope) {
	const db = getDb();
	const member = alias(schema.users, 'member');
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		scope,
		...(scope === 'staff'
			? {
					notice:
						'STAFF EXPORT – contains internal notes and voter names. Share only with project staff.'
				}
			: {}),
		exported_at: new Date().toISOString(),
		project: {
			key: project.key,
			name: project.name,
			description: project.description,
			url: project.url,
			docs_url: project.docsUrl,
			icon: project.icon,
			color: project.color,
			accent_color: project.accentColor,
			visibility: project.visibility,
			settings: {
				submission_policy: project.submissionPolicy,
				voting_enabled: project.votingEnabled,
				attachments_enabled: project.attachmentsEnabled,
				comments_enabled: project.commentsEnabled,
				edit_policy: project.editPolicy,
				allow_anonymous_read: project.allowAnonymousRead
			},
			created_at: iso(project.createdAt),
			archived_at: iso(project.archivedAt)
		},
		members: db
			.select({
				username: member.username,
				name: member.displayName,
				role: schema.projectMembers.role
			})
			.from(schema.projectMembers)
			.innerJoin(member, eq(member.id, schema.projectMembers.userId))
			.where(eq(schema.projectMembers.projectId, project.id))
			.all(),
		labels: db
			.select({ name: schema.ticketLabels.name, color: schema.ticketLabels.color })
			.from(schema.ticketLabels)
			.where(eq(schema.ticketLabels.projectId, project.id))
			.all(),
		releases: db
			.select()
			.from(schema.changelogEntries)
			.where(eq(schema.changelogEntries.projectId, project.id))
			.orderBy(asc(schema.changelogEntries.id))
			.all()
			.map((r) => ({
				id: r.id,
				version: r.version,
				status: r.status,
				target_date: r.targetDate,
				release_date: r.status === 'released' ? r.releaseDate : null,
				summary_html: r.summaryHtml,
				released_at: iso(r.releasedAt)
			})),
		milestones: db
			.select()
			.from(schema.milestones)
			.where(eq(schema.milestones.projectId, project.id))
			.orderBy(asc(schema.milestones.id))
			.all()
			.map((x) => ({
				id: x.id,
				name: x.name,
				description: x.description,
				status: x.status,
				target_date: x.targetDate,
				completed_at: iso(x.completedAt)
			}))
	};
}

const encoder = new TextEncoder();

/** Streams the JSON export: header fields first, then the tickets page by page. */
export function projectJsonStream(
	project: Project,
	scope: ExportScope
): ReadableStream<Uint8Array> {
	let lastId = 0;
	let first = true;
	let started = false;
	return new ReadableStream({
		pull(controller) {
			if (!started) {
				started = true;
				const header = JSON.stringify(projectHeader(project, scope), null, 2);
				controller.enqueue(encoder.encode(`${header.slice(0, -2)},\n  "tickets": [\n`));
				return;
			}
			const page = ticketPage(project, lastId, scope);
			if (!page.tickets.length) {
				controller.enqueue(encoder.encode('\n  ]\n}\n'));
				controller.close();
				return;
			}
			lastId = page.lastId;
			const chunk = page.tickets.map((x) => `    ${JSON.stringify(x)}`).join(',\n');
			controller.enqueue(encoder.encode(`${first ? '' : ',\n'}${chunk}`));
			first = false;
		}
	});
}

/**
 * Makes a value safe for spreadsheets: cells starting with = + - @ (or tab / carriage return)
 * would be evaluated as formulas by Excel, LibreOffice and Google Sheets, so they are prefixed
 * with an apostrophe. Then RFC 4180 quoting is applied.
 */
export function csvCell(value: unknown): string {
	let s = value === null || value === undefined ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
	'Ticket ID',
	'Title',
	'Type',
	'Status',
	'Priority',
	'Reporter',
	'Assignee',
	'Labels',
	'Votes',
	'Release',
	'Milestone',
	'Created',
	'Updated',
	'Completed',
	'URL'
];

/** Streams the ticket CSV (UTF-8 with BOM so spreadsheet apps detect the encoding). */
export function projectCsvStream(project: Project): ReadableStream<Uint8Array> {
	let lastId = 0;
	let started = false;
	return new ReadableStream({
		pull(controller) {
			if (!started) {
				started = true;
				controller.enqueue(encoder.encode(`\uFEFF${CSV_COLUMNS.map(csvCell).join(',')}\r\n`));
				return;
			}
			const page = ticketPage(project, lastId, 'standard');
			if (!page.tickets.length) {
				controller.close();
				return;
			}
			lastId = page.lastId;
			const lines = page.tickets.map((x) =>
				[
					x.key,
					x.title,
					x.type,
					x.status,
					x.priority,
					x.reporter?.username,
					x.assignee?.username,
					x.labels.join('; '),
					x.votes,
					x.release,
					x.milestone,
					x.created_at,
					x.updated_at,
					x.completed_at,
					x.url
				]
					.map(csvCell)
					.join(',')
			);
			controller.enqueue(encoder.encode(`${lines.join('\r\n')}\r\n`));
		}
	});
}

/** A user's own submissions and comments, in projects they can still view. */
export function personalExport(user: {
	id: number;
	role: 'admin' | 'user';
	status: 'active' | 'disabled';
}) {
	const db = getDb();
	const projectIds = viewableProjectIds(user);
	if (!projectIds.length) return { tickets: [], comments: [] };
	const base = publicBaseUrl();
	const t = schema.tickets;
	const tickets = db
		.select({ t, key: schema.projects.key, projectName: schema.projects.name })
		.from(t)
		.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
		.where(and(eq(t.reporterId, user.id), inArray(t.projectId, projectIds)))
		.orderBy(asc(t.id))
		.all()
		.map(({ t: x, key, projectName }) => ({
			key: `${key}-${x.number}`,
			project: projectName,
			url: base ? `${base}/p/${key.toLowerCase()}/tickets/${x.number}` : null,
			type: x.type,
			title: x.title,
			description_text: x.descriptionText,
			details: x.context,
			status: x.status,
			votes: x.voteCount,
			comments: x.commentCount,
			created_at: iso(x.createdAt),
			updated_at: iso(x.updatedAt),
			completed_at: iso(x.completedAt)
		}));
	const comments = db
		.select({
			c: schema.ticketComments,
			number: t.number,
			key: schema.projects.key
		})
		.from(schema.ticketComments)
		.innerJoin(t, eq(t.id, schema.ticketComments.ticketId))
		.innerJoin(schema.projects, eq(schema.projects.id, t.projectId))
		.where(
			and(
				eq(schema.ticketComments.authorId, user.id),
				isNull(schema.ticketComments.deletedAt),
				inArray(t.projectId, projectIds)
			)
		)
		.orderBy(asc(schema.ticketComments.id))
		.all()
		.map(({ c, number, key }) => ({
			ticket: `${key}-${number}`,
			internal: c.internal,
			body_text: c.bodyText,
			created_at: iso(c.createdAt),
			edited_at: iso(c.editedAt)
		}));
	return { tickets, comments };
}

export function personalCsv(tickets: ReturnType<typeof personalExport>['tickets']) {
	const head = [
		'Ticket ID',
		'Project',
		'Title',
		'Type',
		'Status',
		'Votes',
		'Comments',
		'Created',
		'Updated',
		'Completed',
		'URL'
	];
	const lines = tickets.map((x) =>
		[
			x.key,
			x.project,
			x.title,
			x.type,
			x.status,
			x.votes,
			x.comments,
			x.created_at,
			x.updated_at,
			x.completed_at,
			x.url
		]
			.map(csvCell)
			.join(',')
	);
	return `\uFEFF${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}
