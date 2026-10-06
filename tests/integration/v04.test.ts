import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import {
	changeStatus,
	createTicket,
	getTicket,
	getTicketDetail,
	setFollow
} from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { listNotifications } from '../../src/lib/server/services/notifications';
import { createLabel, removeMember, setArchived } from '../../src/lib/server/services/projects';
import {
	addTicketsToRelease,
	createRelease,
	deleteRelease,
	listChangelog,
	listReleases,
	publishRelease,
	publishReview,
	setTicketRelease,
	updateRelease
} from '../../src/lib/server/services/releases';
import {
	createMilestone,
	listMilestones,
	setMilestoneStatus,
	setTicketMilestone,
	updateMilestone
} from '../../src/lib/server/services/milestones';
import {
	createView,
	deleteView,
	duplicateView,
	getView,
	listViews,
	moveView,
	updateView
} from '../../src/lib/server/services/views';
import { bulkUpdate } from '../../src/lib/server/services/bulk';
import { addRelationship } from '../../src/lib/server/services/relationships';
import { queryTickets, ticketNeighbors } from '../../src/lib/server/services/search';
import { listProjectActivity } from '../../src/lib/server/services/project-activity';
import { findProjectById } from '../../src/lib/server/authz';
import { storeImage } from '../../src/lib/server/uploads';
import { parseTicketFilters } from '../../src/lib/shared/filters';
import { closeDatabase, getDb, openDatabase, schema, useDatabase } from '../../src/lib/server/db';
import sharp from 'sharp';
import type { Project, User } from '../../src/lib/server/db/schema';

let owner: User, mod: User, member: User, outsider: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: '<p>x</p>',
	descriptionText: 'x',
	context: {}
});
const ticket = (n: number) => getTicket(project.id, n)!;
const release = (version: string, status: 'planned' | 'in_progress' = 'planned') =>
	createRelease(owner, access(owner, fresh()), {
		version,
		summaryHtml: '',
		targetDate: '2030-01-15',
		status
	})!;

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	mod = await makeUser();
	member = await makeUser();
	outsider = await makeUser();
	project = makeProject(owner, { key: 'SPL' });
	join(owner, project, mod, 'moderator');
	join(owner, project, member);
});

describe('saved views', () => {
	it('keeps personal views private and lets only staff manage shared views', () => {
		const mine = createView(member, access(member, fresh()), {
			name: 'My bugs',
			query: 'type=bug&assignee=me&page=7&evil=1;drop table',
			columns: ['ref', 'status', 'nonsense'],
			shared: false
		});
		// Stored definition is normalised: known filters only, no page, valid columns only.
		expect(mine.query).toBe('type=bug&assignee=me');
		expect(mine.columns).toEqual(['ref', 'status']);
		expect(() =>
			createView(member, access(member, fresh()), {
				name: 'Team',
				query: '',
				columns: [],
				shared: true
			})
		).toThrow(/staff/);
		const shared = createView(mod, access(mod, fresh()), {
			name: 'Unassigned',
			query: 'assignee=none',
			columns: [],
			shared: true
		});

		expect(listViews(member, access(member, fresh())).map((v) => v.name)).toEqual([
			'Unassigned',
			'My bugs'
		]);
		expect(listViews(owner, access(owner, fresh())).map((v) => v.name)).toEqual(['Unassigned']);
		expect(listViews(member, access(member, fresh()))[0].canManage).toBe(false);
		// Others' personal views are invisible.
		expect(() => getView(owner, access(owner, fresh()), mine.id)).toThrow(/not found/);
		expect(() => deleteView(member, access(member, fresh()), shared.id)).toThrow(/cannot/);
		expect(() =>
			updateView(member, access(member, fresh()), shared.id, { name: 'Hijacked' })
		).toThrow();

		updateView(owner, access(owner, fresh()), shared.id, { name: 'Needs triage' });
		const history = listProjectActivity(project.id, 'view', shared.id).map((a) => a.type);
		expect(history).toEqual(['renamed', 'created']);

		const copy = duplicateView(member, access(member, fresh()), shared.id);
		expect(copy.shared).toBe(false);
		expect(copy.name).toBe('Needs triage (copy)');
		moveView(member, access(member, fresh()), copy.id, -1);
		expect(
			listViews(member, access(member, fresh()))
				.filter((v) => !v.shared)
				.map((v) => v.name)
		).toEqual(['Needs triage (copy)', 'My bugs']);
		deleteView(member, access(member, fresh()), mine.id);
		expect(listViews(member, access(member, fresh()))).toHaveLength(2);
	});

	it('cannot be read through another project', () => {
		const other = makeProject(owner, { key: 'OTH' });
		const v = createView(owner, access(owner, fresh()), {
			name: 'Spool only',
			query: '',
			columns: [],
			shared: true
		});
		expect(() => getView(owner, access(owner, other), v.id)).toThrow(/not found/);
		expect(listViews(outsider, access(outsider, fresh()))).toEqual([]);
	});
});

describe('releases', () => {
	it('prevents duplicate versions (case-insensitive) within a project only', () => {
		release('v1.0');
		expect(() => release('V1.0')).toThrow(/already exists/);
		const other = makeProject(owner, { key: 'OTH' });
		expect(
			createRelease(owner, access(owner, other), {
				version: 'v1.0',
				summaryHtml: '',
				targetDate: null,
				status: 'planned'
			})
		).toBeTruthy();
		expect(() =>
			createRelease(member, access(member, fresh()), {
				version: 'v2',
				summaryHtml: '',
				targetDate: null,
				status: 'planned'
			})
		).toThrow(/staff/);
	});

	it('assigns tickets, rejects cross-project releases and reports progress', () => {
		const rel = release('v0.15.0');
		for (const title of ['A', 'B', 'C', 'D'])
			createTicket(member, access(member, fresh()), input(title));
		const other = makeProject(owner, { key: 'OTH' });
		const foreign = createRelease(owner, access(owner, other), {
			version: 'x',
			summaryHtml: '',
			targetDate: null,
			status: 'planned'
		})!;
		expect(() => setTicketRelease(owner, access(owner, fresh()), ticket(1), foreign.id)).toThrow(
			/does not exist in this project/
		);
		// The database refuses it too.
		expect(() =>
			getDb()
				.update(schema.tickets)
				.set({ releaseId: foreign.id })
				.where(eq(schema.tickets.id, ticket(1).id))
				.run()
		).toThrow(/another project/);

		expect(listReleases(project.id)[0].progress).toEqual({
			total: 0,
			completed: 0,
			resolved: 0,
			percent: null
		});
		setTicketRelease(mod, access(mod, fresh()), ticket(1), rel.id);
		expect(
			addTicketsToRelease(owner, access(owner, fresh()), rel.id, ['SPL-2', '3', 'SPL-1'])
		).toBe(2);
		expect(() => addTicketsToRelease(owner, access(owner, fresh()), rel.id, ['OTH-1'])).toThrow();
		changeStatus(owner, access(owner, fresh()), ticket(1), { status: 'completed', note: null });
		expect(listReleases(project.id)[0].progress).toMatchObject({
			total: 3,
			completed: 1,
			percent: 33
		});
		const history = getTicketDetail(owner, ticket(1), { internal: true }).activity.map(
			(a) => a.type
		);
		expect(history).toContain('release');
		// Moving and unassigning.
		const next = release('v0.16.0');
		setTicketRelease(owner, access(owner, fresh()), ticket(2), next.id);
		setTicketRelease(owner, access(owner, fresh()), ticket(3), null);
		expect(listReleases(project.id).find((r) => r.id === rel.id)!.progress.total).toBe(1);
		expect(() => setTicketRelease(member, access(member, fresh()), ticket(4), rel.id)).toThrow(
			/staff/
		);
	});

	it('publishes once, never completes tickets, feeds the changelog and notifies followers', () => {
		const rel = release('v1.0');
		createTicket(member, access(member, fresh()), input('Shipped'));
		createTicket(member, access(member, fresh()), input('Not done'));
		createTicket(member, access(member, fresh()), input('Detached'));
		setFollow(outsider, ticket(1), true); // will not be notified: not a project member
		addTicketsToRelease(owner, access(owner, fresh()), rel.id, ['1', '2', '3']);
		changeStatus(owner, access(owner, fresh()), ticket(1), { status: 'completed', note: null });

		const review = publishReview(project.id, rel.id)!;
		expect(review.unresolved.map((t) => t.number)).toEqual([2, 3]);
		expect(() => publishRelease(mod, access(mod, fresh()), rel.id)).toThrow(/owners/);

		const result = publishRelease(owner, access(owner, fresh()), rel.id, {
			detachUnresolved: false
		});
		expect(result).toEqual({ completed: 1, unresolved: 2, detached: 0 });
		expect(ticket(2).status).toBe('open'); // not silently completed
		expect(ticket(2).releaseId).toBe(rel.id);
		expect(() => publishRelease(owner, access(owner, fresh()), rel.id)).toThrow(/already/);

		const changelog = listChangelog(project.id);
		expect(changelog).toHaveLength(1);
		expect(changelog[0].tickets.map((t) => t.number)).toEqual([1]); // shipped tickets only
		expect(changelog[0].releasedAt).toBeTruthy();
		const memberNotes = listNotifications(member.id).filter((n) => n.type === 'release');
		expect(memberNotes).toHaveLength(1);
		expect(memberNotes[0].data).toMatchObject({ version: 'v1.0', count: 1 });
		expect(listNotifications(outsider.id)).toHaveLength(0);

		// Notes can be edited afterwards, with history; it can't be moved back or deleted.
		updateRelease(owner, access(owner, fresh()), rel.id, {
			version: 'v1.0',
			summaryHtml: '<p>Fixes</p>',
			targetDate: '2030-01-15',
			status: 'released'
		});
		expect(listProjectActivity(project.id, 'release', rel.id).map((a) => a.type)).toEqual([
			'notes',
			'published',
			'tickets',
			'created'
		]);
		expect(() =>
			updateRelease(owner, access(owner, fresh()), rel.id, {
				version: 'v1.0',
				summaryHtml: '',
				targetDate: null,
				status: 'planned'
			})
		).toThrow();
		expect(() => deleteRelease(owner, access(owner, fresh()), rel.id)).toThrow();
		// A published release accepts no new tickets.
		createTicket(member, access(member, fresh()), input('Late'));
		expect(() => setTicketRelease(owner, access(owner, fresh()), ticket(4), rel.id)).toThrow(
			/released/
		);
	});

	it('can move unresolved tickets out when publishing', () => {
		const rel = release('v2.0');
		createTicket(member, access(member, fresh()), input('Pending'));
		addTicketsToRelease(owner, access(owner, fresh()), rel.id, ['1']);
		const result = publishRelease(owner, access(owner, fresh()), rel.id, {
			detachUnresolved: true
		});
		expect(result.detached).toBe(1);
		expect(ticket(1).releaseId).toBeNull();
		expect(ticket(1).status).toBe('open');
	});

	it('deleting a planned release unassigns its tickets', () => {
		const rel = release('v3');
		createTicket(member, access(member, fresh()), input('A'));
		addTicketsToRelease(owner, access(owner, fresh()), rel.id, ['1']);
		deleteRelease(owner, access(owner, fresh()), rel.id);
		expect(ticket(1).releaseId).toBeNull();
	});
});

describe('milestones', () => {
	it('tracks progress, completion, reopening and archiving', () => {
		const ms = createMilestone(mod, access(mod, fresh()), {
			name: 'Improve Mobile Experience',
			description: 'Make it nice on phones',
			targetDate: '2030-03-01'
		})!;
		expect(() =>
			createMilestone(owner, access(owner, fresh()), {
				name: 'improve mobile experience',
				description: null,
				targetDate: null
			})
		).toThrow(/already exists/);
		expect(() =>
			createMilestone(member, access(member, fresh()), {
				name: 'Nope',
				description: null,
				targetDate: null
			})
		).toThrow(/staff/);
		createTicket(member, access(member, fresh()), input('A'));
		createTicket(member, access(member, fresh()), input('B'));
		setTicketMilestone(owner, access(owner, fresh()), ticket(1), ms.id);
		setTicketMilestone(owner, access(owner, fresh()), ticket(2), ms.id);
		changeStatus(owner, access(owner, fresh()), ticket(1), { status: 'completed', note: null });
		expect(listMilestones(project.id)[0].progress).toMatchObject({
			total: 2,
			completed: 1,
			percent: 50
		});
		updateMilestone(owner, access(owner, fresh()), ms.id, {
			name: 'Mobile',
			description: null,
			targetDate: null
		});
		setMilestoneStatus(owner, access(owner, fresh()), ms.id, 'completed');
		expect(listMilestones(project.id)[0].completedAt).toBeTruthy();
		// Closed milestones accept no new tickets.
		createTicket(member, access(member, fresh()), input('C'));
		expect(() => setTicketMilestone(owner, access(owner, fresh()), ticket(3), ms.id)).toThrow(
			/completed/
		);
		setMilestoneStatus(owner, access(owner, fresh()), ms.id, 'open');
		setMilestoneStatus(owner, access(owner, fresh()), ms.id, 'archived');
		expect(listMilestones(project.id, { statuses: ['open'] })).toHaveLength(0);
		expect(listProjectActivity(project.id, 'milestone', ms.id).map((a) => a.type)).toEqual([
			'archived',
			'reopened',
			'completed',
			'edited',
			'renamed',
			'created'
		]);
	});

	it('rejects cross-project milestones and respects archived projects', () => {
		const other = makeProject(owner, { key: 'OTH' });
		const foreign = createMilestone(owner, access(owner, other), {
			name: 'X',
			description: null,
			targetDate: null
		})!;
		createTicket(member, access(member, fresh()), input('A'));
		expect(() => setTicketMilestone(owner, access(owner, fresh()), ticket(1), foreign.id)).toThrow(
			/does not exist/
		);
		setArchived(owner.id, fresh(), true, null);
		expect(() =>
			createMilestone(owner, access(owner, fresh()), {
				name: 'Late',
				description: null,
				targetDate: null
			})
		).toThrow();
	});
});

describe('bulk release and milestone assignment', () => {
	it('assigns, skips no-ops and records history', () => {
		const rel = release('v1');
		const ms = createMilestone(owner, access(owner, fresh()), {
			name: 'Perf',
			description: null,
			targetDate: null
		})!;
		for (const title of ['A', 'B', 'C'])
			createTicket(member, access(member, fresh()), input(title));
		setTicketRelease(owner, access(owner, fresh()), ticket(1), rel.id);
		const r1 = bulkUpdate(owner, access(owner, fresh()), [1, 2, 3, 99], {
			kind: 'release',
			releaseId: rel.id
		});
		expect(r1.updated).toEqual([2, 3]);
		expect(r1.skipped.map((s) => s.number)).toEqual([1, 99]);
		const r2 = bulkUpdate(owner, access(owner, fresh()), [1, 2], {
			kind: 'release',
			releaseId: null
		});
		expect(r2.updated).toEqual([1, 2]);
		expect(ticket(1).releaseId).toBeNull();

		const r3 = bulkUpdate(owner, access(owner, fresh()), [1, 2, 3], {
			kind: 'milestone',
			milestoneId: ms.id
		});
		expect(r3.updated).toHaveLength(3);
		const activity = getTicketDetail(owner, ticket(2), { internal: true }).activity.at(-1)!;
		expect(activity).toMatchObject({ type: 'milestone', data: { to: 'Perf', bulk: true } });
		const other = makeProject(owner, { key: 'OTH' });
		const foreign = createMilestone(owner, access(owner, other), {
			name: 'X',
			description: null,
			targetDate: null
		})!;
		expect(() =>
			bulkUpdate(owner, access(owner, fresh()), [1], { kind: 'milestone', milestoneId: foreign.id })
		).toThrow();
		expect(() =>
			bulkUpdate(member, access(member, fresh()), [1], { kind: 'release', releaseId: null })
		).toThrow(/staff/);
	});
});

describe('ticket filters', () => {
	async function png() {
		const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
			.png()
			.toBuffer();
		return new File([new Uint8Array(buf)], 'x.png', { type: 'image/png' });
	}
	const list = (query: string, actor: User, staff = true) =>
		queryTickets({
			scope: eq(schema.tickets.projectId, project.id),
			filters: parseTicketFilters(new URLSearchParams(query)),
			pageSize: 50,
			projectKey: 'SPL',
			actorId: actor.id,
			staff
		}).rows.map((r) => r.number);

	it('filters by release, milestone, following, attachments and dependencies', async () => {
		const rel = release('v1');
		const ms = createMilestone(owner, access(owner, fresh()), {
			name: 'M',
			description: null,
			targetDate: null
		})!;
		for (const title of ['A', 'B', 'C', 'D'])
			createTicket(owner, access(owner, fresh()), input(title));
		setTicketRelease(owner, access(owner, fresh()), ticket(1), rel.id);
		setTicketMilestone(owner, access(owner, fresh()), ticket(2), ms.id);
		setFollow(member, ticket(3), true);
		const att = await storeImage(await png(), { uploaderId: owner.id });
		addComment(
			owner,
			access(owner, fresh()),
			ticket(4),
			{ html: '<p>n</p>', text: 'n' },
			[att.id],
			{
				internal: true
			}
		);
		addRelationship(owner, access(owner, fresh()), ticket(2), 'blocks', 'SPL-3');

		expect(list(`release=${rel.id}`, owner)).toEqual([1]);
		expect(list('release=none', owner).sort()).toEqual([2, 3, 4]);
		expect(list(`milestone=${ms.id}`, owner)).toEqual([2]);
		// Staff-only filters are ignored for everyone else (and planning data is hidden).
		expect(list(`release=${rel.id}`, member, false).sort()).toEqual([1, 2, 3, 4]);
		expect(
			queryTickets({
				scope: eq(schema.tickets.projectId, project.id),
				filters: parseTicketFilters(new URLSearchParams()),
				pageSize: 50,
				staff: false
			}).rows.every((r) => r.release === null)
		).toBe(true);
		expect(list('following=1', member)).toEqual([3]);
		// An image on an internal note does not count as an attachment.
		expect(list('attachments=1', owner)).toEqual([]);
		expect(list('blocked=1', owner)).toEqual([3]);
		changeStatus(owner, access(owner, fresh()), ticket(2), { status: 'completed', note: null });
		expect(list('blocked=1', owner)).toEqual([]);
		expect(list('assignee=none&sort=oldest', owner)).toEqual([1, 2, 3, 4]);
	});

	it('finds previous and next tickets in the same list order', () => {
		for (const title of ['A', 'B', 'C']) createTicket(owner, access(owner, fresh()), input(title));
		const opts = {
			scope: eq(schema.tickets.projectId, project.id),
			filters: parseTicketFilters(new URLSearchParams('sort=oldest')),
			projectKey: 'SPL',
			staff: true
		};
		expect(ticketNeighbors(opts, ticket(2).id)).toEqual({
			position: 2,
			total: 3,
			prev: 1,
			next: 3
		});
		expect(ticketNeighbors(opts, ticket(1).id)).toMatchObject({ prev: null, next: 2 });
		expect(
			ticketNeighbors(
				{ ...opts, filters: parseTicketFilters(new URLSearchParams('q=zzz')) },
				ticket(1).id
			)
		).toBeNull();
	});
});

describe('notifications', () => {
	it('groups repeated comments on the same ticket while unread', () => {
		const t = createTicket(member, access(member, fresh()), input('A'));
		for (const text of ['one', 'two', 'three'])
			addComment(owner, access(owner, fresh()), getTicket(project.id, t.number)!, {
				html: `<p>${text}</p>`,
				text
			});
		const comments = listNotifications(member.id).filter((n) => n.type === 'comment');
		expect(comments).toHaveLength(1);
		expect(comments[0].data).toMatchObject({ excerpt: 'three', groupCount: 3 });
	});

	it('removed members stop receiving project updates', () => {
		const t = createTicket(member, access(member, fresh()), input('A'));
		removeMember(owner.id, fresh(), member.id, null);
		addComment(owner, access(owner, fresh()), getTicket(project.id, t.number)!, {
			html: '<p>hi</p>',
			text: 'hi'
		});
		expect(listNotifications(member.id).filter((n) => n.type === 'comment')).toHaveLength(0);
	});

	it('respects the milestone preference (off by default)', () => {
		const ms = createMilestone(owner, access(owner, fresh()), {
			name: 'M',
			description: null,
			targetDate: null
		})!;
		createTicket(member, access(member, fresh()), input('A'));
		setTicketMilestone(owner, access(owner, fresh()), ticket(1), ms.id);
		expect(listNotifications(member.id).filter((n) => n.type === 'milestone')).toHaveLength(0);
		getDb()
			.update(schema.users)
			.set({ notificationPrefs: { milestone: true } as never })
			.where(eq(schema.users.id, member.id))
			.run();
		setMilestoneStatus(owner, access(owner, fresh()), ms.id, 'completed');
		expect(listNotifications(member.id).filter((n) => n.type === 'milestone')).toHaveLength(1);
		// Labels are untouched by all of this.
		expect(createLabel(project.id, 'x', 'blue')).toBeTruthy();
	});
});

describe('upgrading to v0.4', () => {
	it('turns changelog entries into releases and links into ticket releases', () => {
		closeDatabase();
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-v04-'));
		const old = path.join(dir, 'migrations');
		fs.cpSync('drizzle', old, { recursive: true });
		for (const f of fs.readdirSync(old)) if (/^000[3-9]/.test(f)) fs.rmSync(path.join(old, f));
		const journal = JSON.parse(fs.readFileSync(path.join(old, 'meta/_journal.json'), 'utf8'));
		journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0003');
		fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal));
		const file = path.join(dir, 'tikket.db');
		const before = openDatabase(file, old);
		before.sqlite.exec(`
			insert into users(id, username, email, display_name, password_hash) values (1, 'keep', 'keep@x', 'Keep', 'h');
			insert into projects(id, key, name, ticket_counter) values (1, 'OLD', 'Old', 2);
			insert into tickets(id, project_id, number, type, title, description_html, description_text, reporter_id, status)
				values (1, 1, 1, 'bug', 'Shipped', '<p>x</p>', 'x', 1, 'completed'),
				       (2, 1, 2, 'bug', 'Untouched', '<p>x</p>', 'x', 1, 'open');
			insert into changelog_entries(id, project_id, version, release_date, published) values
				(1, 1, 'v1', '2024-01-01', 1), (2, 1, 'V1', '2024-02-01', 1), (3, 1, 'v2', '2025-01-01', 0);
			insert into changelog_ticket_links(entry_id, ticket_id) values (1, 1), (2, 1);
		`);
		before.sqlite.close();

		const after = openDatabase(file, path.resolve('drizzle'));
		const entries = after.sqlite
			.prepare(
				'select id, version, status, published, target_date as targetDate from changelog_entries order by id'
			)
			.all();
		expect(entries).toEqual([
			{ id: 1, version: 'v1 (1)', status: 'released', published: 1, targetDate: null },
			{ id: 2, version: 'V1', status: 'released', published: 1, targetDate: null },
			{ id: 3, version: 'v2', status: 'planned', published: 0, targetDate: '2025-01-01' }
		]);
		// The most recent entry wins for a ticket listed twice; others stay unassigned.
		expect(
			after.sqlite.prepare('select id, release_id as r from tickets order by id').all()
		).toEqual([
			{ id: 1, r: 2 },
			{ id: 2, r: null }
		]);
		expect(
			after.sqlite
				.prepare("select count(*) as n from sqlite_master where name = 'changelog_ticket_links'")
				.get()
		).toEqual({ n: 0 });
		after.sqlite.close();
		useDatabase(null);
	});
});
