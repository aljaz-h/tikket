import { and, asc, desc, eq, gt, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
	DEFAULT_ROADMAP_IMAGE,
	DEFAULT_ROADMAP_SETTINGS,
	ROADMAP_AUDIENCES,
	RESOLVED_STATUSES,
	ROADMAP_IMAGE_LAYOUTS,
	type RoadmapSettings
} from '../../shared/constants';
import { accessForProject, type ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Project } from '../db/schema';
import { audit } from './audit';
import { activeMilestones } from './milestones';
import { progressFor } from './releases';
import { ServiceError } from './users';

/**
 * Roadmap visibility. Owners decide who sees the roadmap and which planning details it shows.
 * Staff (owners, moderators, administrators) always see everything; everyone else only gets the
 * fields switched on here – they are left out of the server response, not merely hidden.
 */

export function roadmapSettings(project: Pick<Project, 'roadmapSettings'>): RoadmapSettings {
	const stored = project.roadmapSettings;
	return {
		...DEFAULT_ROADMAP_SETTINGS,
		...(stored ?? {}),
		image: { ...DEFAULT_ROADMAP_IMAGE, ...(stored?.image ?? {}) }
	};
}

/**
 * May the live public image (/public/projects/KEY/roadmap.png) be served right now? It must be
 * switched on AND the roadmap itself must be viewable by an anonymous visitor – so it stops
 * working the moment the roadmap or the project stops being public. Existing projects are never
 * exposed implicitly: the image setting defaults to off.
 */
export function publicImageAllowed(project: Project) {
	const settings = roadmapSettings(project);
	if (!settings.image.public) return false;
	return canViewRoadmap(accessForProject(null, project), settings);
}

export function canViewRoadmap(access: ProjectAccess, settings: RoadmapSettings) {
	if (access.isStaff) return true;
	if (settings.audience === 'staff') return false;
	if (settings.audience === 'members') return access.role !== null;
	return access.canView;
}

const bool = z.boolean();
export const roadmapSettingsSchema = z.object({
	audience: z.enum(ROADMAP_AUDIENCES),
	showOpen: bool,
	showCreators: bool,
	image: z.object({
		public: bool,
		layout: z.enum(ROADMAP_IMAGE_LAYOUTS),
		showLogo: bool,
		showTimestamp: bool
	}),
	showReleases: bool,
	showReleaseDates: bool,
	showMilestones: bool,
	showPriorities: bool,
	showVotes: bool,
	showAssignees: bool
});

export function saveRoadmapSettings(
	actorId: number,
	access: ProjectAccess,
	input: RoadmapSettings,
	ip: string | null
) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can change roadmap visibility', 'form', 403);
	const next = roadmapSettingsSchema.parse(input);
	// Dates only make sense together with releases.
	if (!next.showReleases) next.showReleaseDates = false;
	// The public image only exists for a roadmap anonymous visitors can open anyway.
	if (next.image.public) {
		const publicRoadmap = canViewRoadmap(accessForProject(null, access.project), next);
		if (!publicRoadmap)
			throw new ServiceError(
				'The public image needs a public roadmap: set the roadmap to “Anyone who can view the project” in a public project.',
				'imagePublic'
			);
	}
	const previous = roadmapSettings(access.project);
	getDb()
		.update(schema.projects)
		.set({ roadmapSettings: next, updatedAt: new Date() })
		.where(eq(schema.projects.id, access.project.id))
		.run();
	audit({
		actorId,
		action: 'project.roadmap_visibility',
		targetType: 'project',
		targetId: access.project.id,
		data: { from: previous, to: next },
		ip
	});
	return next;
}

const t = schema.tickets;
const RECENT_DAYS = 90;

/**
 * The roadmap as a given viewer may see it: Planned, In Progress and Recently Completed tickets,
 * plus upcoming releases and active milestones when enabled. `full` is for staff.
 */
export function roadmapFor(
	project: Project,
	settings: RoadmapSettings,
	full: boolean,
	/** Include the Open / Unplanned column (staff views pass true; others follow the setting). */
	openColumn = full || settings.showOpen,
	/** The signed-in viewer, to mark the tickets they have voted for. */
	viewerId: number | null = null
) {
	const show = full
		? {
				releases: true,
				releaseDates: true,
				milestones: true,
				priorities: true,
				votes: true,
				assignees: true,
				creators: true
			}
		: {
				releases: settings.showReleases,
				releaseDates: settings.showReleases && settings.showReleaseDates,
				milestones: settings.showMilestones,
				priorities: settings.showPriorities,
				votes: settings.showVotes,
				assignees: settings.showAssignees,
				creators: settings.showCreators
			};
	const db = getDb();
	const assignee = alias(schema.users, 'assignee');
	const creator = alias(schema.users, 'creator');
	const r = schema.changelogEntries;
	const m = schema.milestones;
	const since = new Date(Date.now() - RECENT_DAYS * 864e5);
	const fetchRows = (where: ReturnType<typeof and>, limit: number) =>
		db
			.select({
				number: t.number,
				title: t.title,
				type: t.type,
				status: t.status,
				priority: t.priority,
				assigneeId: t.assigneeId,
				reporterId: t.reporterId,
				milestoneId: t.milestoneId,
				createdAt: t.createdAt,
				voteCount: t.voteCount,
				completedAt: t.completedAt,
				updatedAt: t.updatedAt,
				assigneeName: assignee.displayName,
				assigneeAvatar: assignee.avatarId,
				creatorName: creator.displayName,
				creatorAvatar: creator.avatarId,
				releaseVersion: r.version,
				releaseStatus: r.status,
				milestoneName: m.name
			})
			.from(t)
			.leftJoin(assignee, eq(assignee.id, t.assigneeId))
			.leftJoin(creator, eq(creator.id, t.reporterId))
			.leftJoin(r, eq(r.id, t.releaseId))
			.leftJoin(m, eq(m.id, t.milestoneId))
			.where(and(eq(t.projectId, project.id), where))
			.orderBy(desc(t.voteCount), desc(t.updatedAt))
			.limit(limit)
			.all();
	const recent = and(eq(t.status, 'completed'), isNotNull(t.completedAt), gt(t.completedAt, since));
	// Each column is queried on its own so a long Open backlog can never push planned work out.
	const openRows = openColumn ? fetchRows(eq(t.status, 'open'), 100) : [];
	const activeRows = fetchRows(inArray(t.status, ['planned', 'in_progress']), 300);
	const doneRows = fetchRows(recent, 400);
	const rows = [...openRows, ...activeRows, ...doneRows];

	// "Planned" and "Started" dates come from the ticket history (the latest move into that
	// status); no extra columns are needed. Tickets without such an entry (imported or created
	// directly in the status) fall back to their created date.
	const moved = new Map<number, { planned?: Date; started?: Date }>();
	const ticketIds = rows.length
		? db
				.select({ id: t.id, number: t.number })
				.from(t)
				.where(
					and(
						eq(t.projectId, project.id),
						inArray(
							t.number,
							rows.map((x) => x.number)
						)
					)
				)
				.all()
		: [];
	const numberById = new Map(ticketIds.map((x) => [x.id, x.number]));
	if (ticketIds.length) {
		const history = db
			.select({
				ticketId: schema.ticketActivity.ticketId,
				data: schema.ticketActivity.data,
				createdAt: schema.ticketActivity.createdAt
			})
			.from(schema.ticketActivity)
			.where(
				and(
					eq(schema.ticketActivity.type, 'status'),
					inArray(
						schema.ticketActivity.ticketId,
						ticketIds.map((x) => x.id)
					)
				)
			)
			.orderBy(asc(schema.ticketActivity.id))
			.all();
		for (const h of history) {
			const number = numberById.get(h.ticketId);
			if (number === undefined) continue;
			const entry = moved.get(number) ?? {};
			const to = (h.data as { to?: string }).to;
			if (to === 'planned') entry.planned = h.createdAt;
			if (to === 'in_progress') entry.started = h.createdAt;
			moved.set(number, entry);
		}
	}
	const votedFor = new Set<number>();
	if (viewerId && show.votes && project.votingEnabled && ticketIds.length) {
		const mine = db
			.select({ ticketId: schema.ticketVotes.ticketId })
			.from(schema.ticketVotes)
			.where(
				and(
					eq(schema.ticketVotes.userId, viewerId),
					inArray(
						schema.ticketVotes.ticketId,
						ticketIds.map((x) => x.id)
					)
				)
			)
			.all();
		for (const v of mine) {
			const number = numberById.get(v.ticketId);
			if (number !== undefined) votedFor.add(number);
		}
	}
	const strip = (row: (typeof rows)[number]) => ({
		number: row.number,
		title: row.title,
		type: row.type,
		status: row.status,
		completedAt: row.completedAt,
		voteCount: show.votes && project.votingEnabled ? row.voteCount : null,
		priority: show.priorities ? row.priority : null,
		assignee: show.assignees ? row.assigneeName : null,
		assigneeId: show.assignees ? row.assigneeId : null,
		assigneeAvatar: show.assignees ? row.assigneeAvatar : null,
		// Who created the ticket: only shown when the roadmap's visibility allows it.
		creator:
			show.creators && row.reporterId
				? { id: row.reporterId, name: row.creatorName ?? 'Unknown', avatarId: row.creatorAvatar }
				: null,
		createdAt: row.createdAt,
		plannedAt: moved.get(row.number)?.planned ?? row.createdAt,
		startedAt: moved.get(row.number)?.started ?? row.createdAt,
		voted: votedFor.has(row.number),
		milestoneId: show.milestones ? row.milestoneId : null,
		// Planned/cancelled releases are planning data; published ones are public anyway.
		release:
			show.releases || row.releaseStatus === 'released' ? (row.releaseVersion ?? null) : null,
		milestone: show.milestones ? row.milestoneName : null
	});
	const countOf = (where: ReturnType<typeof and>) =>
		db
			.select({ n: sql<number>`count(*)` })
			.from(t)
			.where(and(eq(t.projectId, project.id), where))
			.get()?.n ?? 0;
	const totals = {
		open: openColumn ? countOf(eq(t.status, 'open')) : 0,
		planned: countOf(eq(t.status, 'planned')),
		in_progress: countOf(eq(t.status, 'in_progress')),
		completed: countOf(recent)
	};
	const columns = {
		open: rows
			.filter((x) => x.status === 'open')
			.slice(0, 100)
			.map(strip),
		planned: rows
			.filter((x) => x.status === 'planned')
			.slice(0, 100)
			.map(strip),
		in_progress: rows
			.filter((x) => x.status === 'in_progress')
			.slice(0, 100)
			.map(strip),
		completed: rows
			.filter((x) => x.status === 'completed')
			.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
			.slice(0, 60)
			.map(strip)
	};
	let releases: {
		id: number;
		version: string;
		targetDate: string | null;
		total: number;
		done: number;
	}[] = [];
	if (show.releases) {
		const upcoming = db
			.select({ id: r.id, version: r.version, targetDate: r.targetDate })
			.from(r)
			.where(and(eq(r.projectId, project.id), inArray(r.status, ['planned', 'in_progress'])))
			.orderBy(asc(r.targetDate), asc(r.id))
			.limit(6)
			.all();
		const progress = progressFor(
			'release',
			upcoming.map((x) => x.id)
		);
		releases = upcoming.map((x) => ({
			id: x.id,
			version: x.version,
			targetDate: show.releaseDates ? x.targetDate : null,
			total: progress.get(x.id)?.total ?? 0,
			done: progress.get(x.id)?.completed ?? 0
		}));
	}
	const milestones = show.milestones
		? activeMilestones(project.id, 6).map((x) => ({
				id: x.id,
				name: x.name,
				targetDate: show.releaseDates || full ? x.targetDate : null,
				total: x.progress.total,
				done: x.progress.completed,
				// The next unfinished ticket, for the progress strip.
				next:
					db
						.select({ title: t.title })
						.from(t)
						.where(and(eq(t.milestoneId, x.id), notInArray(t.status, [...RESOLVED_STATUSES])))
						.orderBy(asc(t.number))
						.limit(1)
						.get()?.title ?? null
			}))
		: [];
	return {
		columns,
		totals,
		releases,
		milestones,
		show: { ...show, open: openColumn }
	};
}
export type RoadmapView = ReturnType<typeof roadmapFor>;
