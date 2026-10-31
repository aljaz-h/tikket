import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import '../../src/lib/server/outbound';
import { drainQueue } from '../../src/lib/server/outbound';
import { createRule } from '../../src/lib/server/automations/rules';
import {
	assignTicket,
	changeStatus,
	createTicket,
	getTicket
} from '../../src/lib/server/services/tickets';
import { saveWorkflow } from '../../src/lib/server/services/workflow';
import {
	publicImageAllowed,
	roadmapFor,
	roadmapSettings,
	saveRoadmapSettings
} from '../../src/lib/server/services/roadmap';
import { clearRoadmapImageCache, prepareRoadmapImage } from '../../src/lib/server/roadmap-image';
import { GET as publicImage } from '../../src/routes/public/projects/[key]/roadmap.png/+server';
import { GET as exportImage } from '../../src/routes/(app)/p/[key]/roadmap/export.png/+server';
import { actions } from '../../src/routes/(app)/p/[key]/roadmap/+page.server';
import { setVote } from '../../src/lib/server/services/tickets';
import { DEFAULT_WORKFLOW } from '../../src/lib/shared/constants';

let owner: User, mod: User, member: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: title,
	context: {}
});
const ticket = (n: number) => getTicket(project.id, n)!;
const status = (user: User, n: number, to: 'open' | 'planned' | 'in_progress' | 'completed') =>
	changeStatus(user, access(user, fresh()), ticket(n), { status: to, note: null });
const settings = (patch: object = {}) => ({ ...roadmapSettings(fresh()), ...patch });
const save = (patch: object) =>
	saveRoadmapSettings(owner.id, access(owner, fresh()), settings(patch) as never, null);
const activity = (n: number, type: string) =>
	getDb()
		.select()
		.from(schema.ticketActivity)
		.where(eq(schema.ticketActivity.ticketId, ticket(n).id))
		.all()
		.filter((a) => a.type === type);

beforeEach(async () => {
	freshDb();
	clearRoadmapImageCache();
	owner = await makeUser();
	mod = await makeUser();
	member = await makeUser();
	project = makeProject(owner, { key: 'RMB', visibility: 'public', allowAnonymousRead: true });
	join(owner, project, mod, 'moderator');
	join(owner, project, member, 'member');
	createTicket(member, access(member, fresh()), input('First'));
	createTicket(member, access(member, fresh()), input('Second'));
});

describe('Open / Unplanned column', () => {
	it('is always there for staff and opt-in for everyone else', () => {
		expect(roadmapFor(fresh(), settings(), true).columns.open).toHaveLength(2);
		const hidden = roadmapFor(fresh(), settings(), false);
		expect(hidden.columns.open).toEqual([]);
		expect(hidden.show.open).toBe(false);
		save({ showOpen: true });
		const shown = roadmapFor(fresh(), settings(), false);
		expect(shown.columns.open.map((t) => t.title).sort()).toEqual(['First', 'Second']);
		expect(shown.totals.open).toBe(2);
	});

	it('keeps a long Open backlog from crowding out planned work', () => {
		status(owner, 1, 'planned');
		for (let i = 0; i < 120; i++) createTicket(member, access(member, fresh()), input(`B${i}`));
		const view = roadmapFor(fresh(), settings(), true);
		expect(view.columns.open).toHaveLength(100);
		expect(view.totals.open).toBe(121);
		expect(view.columns.planned.map((t) => t.number)).toEqual([1]);
	});
});

describe('moving tickets between columns', () => {
	it('walks Open → Planned → In Progress → Completed → Planned with history', () => {
		for (const to of ['planned', 'in_progress', 'completed', 'planned'] as const)
			status(mod, 1, to);
		expect(ticket(1).status).toBe('planned');
		expect(activity(1, 'status').map((a) => (a.data as { to: string }).to)).toEqual([
			'planned',
			'in_progress',
			'completed',
			'planned'
		]);
	});

	it('enforces the project workflow (invalid drops are rejected)', () => {
		saveWorkflow(
			owner.id,
			access(owner, fresh()),
			{
				...DEFAULT_WORKFLOW,
				transitions: {
					open: ['planned'],
					planned: ['in_progress', 'open'],
					in_progress: ['completed', 'planned'],
					completed: ['planned', 'open'],
					on_hold: ['open'],
					declined: ['open'],
					duplicate: ['open']
				}
			},
			null
		);
		expect(() => status(mod, 1, 'completed')).toThrow(/cannot move from Open to Completed/);
		expect(ticket(1).status).toBe('open');
		status(mod, 1, 'planned');
		expect(ticket(1).status).toBe('planned');
	});

	it('is rejected for people who are not staff', () => {
		expect(() => status(member, 1, 'planned')).toThrow(/Only project staff/);
		expect(ticket(1).status).toBe('open');
	});

	it('runs automations and notifies like any status change', async () => {
		createRule(
			owner.id,
			access(owner, fresh()),
			{
				name: 'Planned → high priority',
				enabled: true,
				trigger: 'ticket.status_changed',
				conditions: { any: [] },
				actions: [{ type: 'set_priority', value: 'high' }]
			} as never,
			null
		);
		status(mod, 1, 'planned');
		await drainQueue();
		expect(ticket(1).priority).toBe('high');
		const notified = getDb()
			.select()
			.from(schema.notifications)
			.where(eq(schema.notifications.userId, member.id))
			.all();
		expect(notified.some((n) => n.type === 'status')).toBe(true);
	});

	it('the roadmap move action uses the same service and checks authorization', async () => {
		const call = (user: User | null, n: number, to: string) => {
			const body = new FormData();
			body.set('number', String(n));
			body.set('status', to);
			return (actions.move as (e: never) => Promise<unknown>)({
				locals: { user, clientIp: null },
				params: { key: 'RMB' },
				request: new Request('http://x/', { method: 'POST', body })
			} as never) as Promise<{ moved?: number; status?: number; data?: unknown }>;
		};
		await expect(call(member, 1, 'planned')).rejects.toMatchObject({ status: 403 });
		await expect(call(null, 1, 'planned')).rejects.toBeDefined();
		expect(ticket(1).status).toBe('open');
		expect(await call(mod, 1, 'planned')).toMatchObject({ moved: 1, status: 'planned' });
		expect(ticket(1).status).toBe('planned');
		expect(activity(1, 'status')).toHaveLength(1);
		// A refused transition comes back as a form failure the page turns into a toast.
		saveWorkflow(
			owner.id,
			access(owner, fresh()),
			{ ...DEFAULT_WORKFLOW, requireNote: ['completed'] },
			null
		);
		expect(await call(mod, 1, 'completed')).toMatchObject({ status: 400 });
		expect(ticket(1).status).toBe('planned');
	});
});

describe('Assign to me', () => {
	const mine = (user: User, n: number) =>
		assignTicket(user, access(user, fresh()), ticket(n), user.id);

	it('works for owners and moderators and records history, automations and followers', async () => {
		createRule(
			owner.id,
			access(owner, fresh()),
			{
				name: 'Assigned → medium',
				enabled: true,
				trigger: 'ticket.assignee_changed',
				conditions: { any: [] },
				actions: [{ type: 'set_priority', value: 'medium' }]
			} as never,
			null
		);
		mine(owner, 1);
		mine(mod, 2);
		expect(ticket(1).assigneeId).toBe(owner.id);
		expect(ticket(2).assigneeId).toBe(mod.id);
		expect(activity(1, 'assigned')).toHaveLength(1);
		await drainQueue();
		expect(ticket(1).priority).toBe('medium');
		const followers = getDb()
			.select()
			.from(schema.ticketFollowers)
			.where(eq(schema.ticketFollowers.ticketId, ticket(1).id))
			.all();
		expect(followers.some((f) => f.userId === owner.id)).toBe(true);
	});

	it('is denied to ordinary members and is a no-op when already assigned', () => {
		expect(() => mine(member, 1)).toThrow(/Only project staff/);
		expect(ticket(1).assigneeId).toBeNull();
		mine(mod, 1);
		mine(mod, 1);
		expect(activity(1, 'assigned')).toHaveLength(1);
	});

	it('the roadmap assign action only ever assigns the caller', async () => {
		const body = new FormData();
		body.set('number', '1');
		body.set('assigneeId', String(owner.id)); // ignored
		const result = await (actions.assign as (e: never) => Promise<unknown>)({
			locals: { user: mod, clientIp: null },
			params: { key: 'RMB' },
			request: new Request('http://x/', { method: 'POST', body })
		} as never);
		expect(result).toEqual({ assigned: 1 });
		expect(ticket(1).assigneeId).toBe(mod.id);
	});
});

describe('roadmap image', () => {
	const request = (headers: Record<string, string> = {}) => new Request('http://x/', { headers });
	const publicGet = (headers?: Record<string, string>, key = 'RMB') =>
		(publicImage as (e: never) => Promise<Response>)({
			params: { key },
			request: request(headers)
		} as never).catch((e: { status: number }) => e);
	const exportGet = (user: User | null, headers?: Record<string, string>) =>
		(exportImage as (e: never) => Promise<Response>)({
			locals: { user },
			params: { key: 'RMB' },
			request: request(headers),
			url: new URL('http://x/p/rmb/roadmap/export.png')
		} as never).catch((e: { status: number }) => e);

	it('renders a PNG, including long titles and empty columns', async () => {
		createTicket(
			member,
			access(member, fresh()),
			input('A very long title '.repeat(30) + 'X'.repeat(200))
		);
		status(mod, 1, 'planned');
		const image = prepareRoadmapImage(fresh(), settings(), true);
		const png = await image.png();
		const meta = await sharp(png).metadata();
		expect(meta.format).toBe('png');
		expect(meta.width).toBe(2400);
		expect(meta.height).toBeGreaterThan(300);
		expect(image.columns.map((c) => c.id)).toEqual(['open', 'planned', 'in_progress', 'completed']);
		expect(image.columns.find((c) => c.id === 'in_progress')!.cards).toEqual([]);
	});

	it('only contains what the roadmap visibility allows', () => {
		status(mod, 1, 'planned');
		assignTicket(owner, access(owner, fresh()), ticket(1), mod.id);
		const view = prepareRoadmapImage(
			fresh(),
			settings({ showAssignees: false, showVotes: false }),
			false
		);
		expect(view.columns.map((c) => c.id)).toEqual(['planned', 'in_progress', 'completed']);
		const card = view.columns[0].cards[0];
		expect(Object.keys(card).sort()).toEqual(['key', 'release', 'title', 'type', 'votes']);
		expect(card.votes).toBeNull();
		expect(card.release).toBeNull();
		expect(JSON.stringify(view.columns)).not.toContain(mod.displayName);
	});

	it('changes its ETag exactly when roadmap content changes', async () => {
		status(mod, 1, 'planned');
		const a = prepareRoadmapImage(fresh(), settings(), false).etag;
		expect(prepareRoadmapImage(fresh(), settings(), false).etag).toBe(a);
		status(mod, 2, 'planned');
		const b = prepareRoadmapImage(fresh(), settings(), false).etag;
		expect(b).not.toBe(a);
		// Cached renders are reused, one entry per project.
		const first = await prepareRoadmapImage(fresh(), settings(), false).png();
		expect(await prepareRoadmapImage(fresh(), settings(), false).png()).toBe(first);
	});

	it('public image is off by default and never exposes existing projects', async () => {
		expect(publicImageAllowed(fresh())).toBe(false);
		const res = (await publicGet()) as { status: number };
		expect(res.status).toBe(404);
	});

	it('public image follows the setting, the roadmap audience and project visibility', async () => {
		save({ image: { ...settings().image, public: true } });
		expect(publicImageAllowed(fresh())).toBe(true);
		const res = (await publicGet()) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.headers.get('cache-control')).toMatch(/public, max-age=\d+/);
		expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
		const etag = res.headers.get('etag')!;
		expect(etag).toBeTruthy();
		const again = (await publicGet({ 'if-none-match': etag })) as Response;
		expect(again.status).toBe(304);

		// A roadmap change invalidates the cached ETag.
		status(mod, 1, 'planned');
		const changed = (await publicGet({ 'if-none-match': etag })) as Response;
		expect(changed.status).toBe(200);
		expect(changed.headers.get('etag')).not.toBe(etag);

		// Restricting the roadmap stops the image immediately (setting stays stored → switched off on save).
		expect(() =>
			save({ audience: 'members', image: { ...settings().image, public: true } })
		).toThrow(/public roadmap/);
		save({ audience: 'members', image: { ...settings().image, public: false } });
		expect(((await publicGet()) as { status: number }).status).toBe(404);
	});

	it('public image stops when the project becomes private even if the flag stays on', async () => {
		save({ image: { ...settings().image, public: true } });
		getDb()
			.update(schema.projects)
			.set({ visibility: 'private' })
			.where(eq(schema.projects.id, project.id))
			.run();
		expect(publicImageAllowed(fresh())).toBe(false);
		expect(((await publicGet()) as { status: number }).status).toBe(404);
		expect(((await publicGet(undefined, 'NOPE')) as { status: number }).status).toBe(404);
	});

	it('private roadmaps need a session for the export route', async () => {
		save({ audience: 'staff' });
		expect(((await exportGet(null)) as { status: number }).status).toBe(404);
		expect(((await exportGet(member)) as { status: number }).status).toBe(404);
		const ok = (await exportGet(mod)) as Response;
		expect(ok.status).toBe(200);
		expect(ok.headers.get('cache-control')).toBe('private, no-cache');
	});

	it('a public roadmap can be exported signed out; the Open column is staff-only by default', async () => {
		const anon = (await exportGet(null)) as Response;
		expect(anon.status).toBe(200);
		const staff = prepareRoadmapImage(fresh(), settings(), true);
		const visitor = prepareRoadmapImage(fresh(), settings(), false);
		expect(staff.columns).toHaveLength(4);
		expect(visitor.columns).toHaveLength(3);
		expect(staff.etag).not.toBe(visitor.etag);
	});
});

describe('roadmap card data', () => {
	it('derives planned and started dates from the history and falls back to created', () => {
		status(mod, 1, 'planned');
		status(mod, 2, 'planned');
		status(mod, 2, 'in_progress');
		const view = roadmapFor(fresh(), settings(), true);
		const planned = view.columns.planned[0];
		expect(planned.plannedAt.getTime()).toBeGreaterThanOrEqual(planned.createdAt.getTime());
		const started = view.columns.in_progress[0];
		expect(started.startedAt.getTime()).toBeGreaterThanOrEqual(started.createdAt.getTime());
		// An open ticket has no history: both dates fall back to the created date.
		createTicket(member, access(member, fresh()), input('Third'));
		const open = roadmapFor(fresh(), settings(), true).columns.open[0];
		expect(open.plannedAt).toEqual(open.createdAt);
	});

	it('shows creators only to staff unless the owner allows it', () => {
		status(mod, 1, 'planned');
		const staff = roadmapFor(fresh(), settings(), true).columns.planned[0];
		expect(staff.creator).toMatchObject({ name: member.displayName });
		const hidden = roadmapFor(fresh(), settings(), false).columns.planned[0];
		expect(hidden.creator).toBeNull();
		save({ showCreators: true });
		expect(roadmapFor(fresh(), settings(), false).columns.planned[0].creator).toMatchObject({
			name: member.displayName
		});
	});

	it("marks the tickets the viewer voted for, with the ticket page's vote rules", () => {
		status(mod, 1, 'planned');
		setVote(member, access(member, fresh()), ticket(1), true);
		const mine = roadmapFor(fresh(), settings(), false, undefined, member.id).columns.planned[0];
		expect(mine.voted).toBe(true);
		expect(mine.voteCount).toBe(1);
		expect(
			roadmapFor(fresh(), settings(), false, undefined, owner.id).columns.planned[0].voted
		).toBe(false);
	});

	it('the roadmap vote action uses setVote and refuses people who cannot vote', async () => {
		status(mod, 1, 'planned');
		const call = (user: User | null, on: boolean) => {
			const body = new FormData();
			body.set('number', '1');
			body.set('on', String(on));
			return (actions.vote as (e: never) => Promise<unknown>)({
				locals: { user, clientIp: null },
				params: { key: 'RMB' },
				request: new Request('http://x/', { method: 'POST', body })
			} as never);
		};
		expect(await call(member, true)).toEqual({ voted: 1, voteCount: 1 });
		expect(await call(member, false)).toEqual({ voted: 1, voteCount: 0 });
		await expect(call(null, true)).rejects.toBeDefined();
	});
});
