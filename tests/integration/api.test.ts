import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import { resetApiLimiters } from '../../src/lib/server/api/http';
import {
	authenticateToken,
	createPersonalToken,
	createProjectToken,
	hashToken,
	listTokens,
	revokeToken
} from '../../src/lib/server/api/tokens';
import { pruneIdempotency } from '../../src/lib/server/api/resources';
import { openApiDocument } from '../../src/lib/server/api/openapi';
import { createTicket, getTicket } from '../../src/lib/server/services/tickets';
import { changeMemberRole, createLabel } from '../../src/lib/server/services/projects';
import { saveWorkflow } from '../../src/lib/server/services/workflow';
import { DEFAULT_WORKFLOW } from '../../src/lib/shared/constants';
import * as me from '../../src/routes/api/v1/me/+server';
import * as projects from '../../src/routes/api/v1/projects/+server';
import * as projectOne from '../../src/routes/api/v1/projects/[key]/+server';
import * as tickets from '../../src/routes/api/v1/projects/[key]/tickets/+server';
import * as ticketOne from '../../src/routes/api/v1/projects/[key]/tickets/[number]/+server';
import * as comments from '../../src/routes/api/v1/projects/[key]/tickets/[number]/comments/+server';
import * as labels from '../../src/routes/api/v1/projects/[key]/labels/+server';
import * as members from '../../src/routes/api/v1/projects/[key]/members/+server';
import * as milestones from '../../src/routes/api/v1/projects/[key]/milestones/+server';

let owner: User, member: User, outsider: User, project: Project;
const fresh = () => findProjectById(project.id)!;

type Handler = (event: RequestEvent) => Promise<Response> | Response;
async function call(
	handler: unknown,
	opts: {
		token?: string;
		params?: Record<string, string>;
		method?: string;
		path?: string;
		body?: unknown;
		headers?: Record<string, string>;
	} = {}
) {
	const url = new URL(`http://localhost${opts.path ?? '/api/v1/x'}`);
	const headers = new Headers(opts.headers);
	if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
	if (opts.body !== undefined && !headers.has('content-type'))
		headers.set('content-type', 'application/json');
	const request = new Request(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
	});
	const res = await (handler as Handler)({
		request,
		url,
		params: opts.params ?? {},
		locals: { clientIp: '203.0.113.9', user: null, session: null }
	} as unknown as RequestEvent);
	const text = await res.text();
	return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const pat = (user: User, scopes: string[], expiresInDays: number | null = 30) =>
	createPersonalToken(user, { name: 'test', scopes, expiresInDays }, null).token;
const prj = (scopes: string[]) =>
	createProjectToken(
		owner.id,
		access(owner, fresh()),
		{ name: 'ci', scopes, expiresInDays: null },
		null
	).token;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: title,
	context: {}
});

beforeEach(async () => {
	freshDb();
	resetApiLimiters();
	owner = await makeUser();
	member = await makeUser();
	outsider = await makeUser();
	project = makeProject(owner, { key: 'API' });
	makeProject(owner, { key: 'OTR' });
	join(owner, project, member);
});

describe('tokens', () => {
	it('stores only a hash and shows the token once', () => {
		const { token, record } = createPersonalToken(
			member,
			{ name: 'CLI', scopes: ['tickets:read'], expiresInDays: 30 },
			null
		);
		expect(token).toMatch(/^tkt_pat_[A-Za-z0-9_-]{40}$/);
		const row = getDb()
			.select()
			.from(schema.apiTokens)
			.where(eq(schema.apiTokens.id, record.id))
			.get()!;
		expect(row.tokenHash).toBe(hashToken(token));
		expect(JSON.stringify(row)).not.toContain(token);
		expect(row.prefix).toBe(token.slice(0, 12));
		const listed = listTokens({ userId: member.id, kind: 'personal' });
		expect(JSON.stringify(listed)).not.toContain(row.tokenHash);
		// Audit entries identify the token but never contain it.
		const audits = getDb().select().from(schema.auditLogs).all();
		expect(audits.some((a) => a.action === 'token.created')).toBe(true);
		expect(JSON.stringify(audits)).not.toContain(token);
	});

	it('drops unknown scopes and rejects tokens without valid scopes', () => {
		const { record } = createPersonalToken(
			member,
			{ name: 'x', scopes: ['tickets:read', 'admin:all', 'tickets:create'], expiresInDays: 7 },
			null
		);
		expect(record.scopes).toEqual(['tickets:read']);
		expect(() =>
			createPersonalToken(member, { name: 'x', scopes: ['admin:all'], expiresInDays: 7 }, null)
		).toThrow(/scope/);
		expect(() =>
			createPersonalToken(member, { name: 'x', scopes: ['tickets:read'], expiresInDays: 3 }, null)
		).toThrow(/expiry/);
	});

	it('rejects invalid, expired, revoked and disabled-user tokens', async () => {
		expect(authenticateToken(null)).toBe('missing');
		expect(authenticateToken('Bearer nope')).toBe('malformed');
		expect(authenticateToken(`Bearer tkt_pat_${'a'.repeat(40)}`)).toBe('invalid');
		const { token, record } = createPersonalToken(
			member,
			{ name: 'x', scopes: ['tickets:read'], expiresInDays: 7 },
			null
		);
		expect(typeof authenticateToken(`Bearer ${token}`)).toBe('object');
		expect(authenticateToken(`Bearer ${token}`, Date.now() + 8 * 864e5)).toBe('expired');
		revokeToken(member.id, record.id, { kind: 'personal' }, null);
		expect(authenticateToken(`Bearer ${token}`)).toBe('revoked');

		const t2 = pat(member, ['tickets:read']);
		getDb()
			.update(schema.users)
			.set({ status: 'disabled' })
			.where(eq(schema.users.id, member.id))
			.run();
		expect(authenticateToken(`Bearer ${t2}`)).toBe('inactive');
	});

	it('only lets the owner revoke a personal token', () => {
		const { record } = createPersonalToken(
			member,
			{ name: 'x', scopes: ['tickets:read'], expiresInDays: 7 },
			null
		);
		expect(() => revokeToken(owner.id, record.id, { kind: 'personal' }, null)).toThrow(/not found/);
	});

	it('project tokens: owner only, and stop working when the creator is no longer owner', async () => {
		expect(() =>
			createProjectToken(
				member.id,
				access(member, fresh()),
				{ name: 'x', scopes: ['tickets:read'], expiresInDays: null },
				null
			)
		).toThrow(/owners/);
		const coOwner = await makeUser();
		join(owner, project, coOwner, 'owner');
		const token = createProjectToken(
			coOwner.id,
			access(coOwner, fresh()),
			{ name: 'x', scopes: ['tickets:read'], expiresInDays: null },
			null
		).token;
		expect(typeof authenticateToken(`Bearer ${token}`)).toBe('object');
		changeMemberRole(owner.id, fresh(), coOwner.id, 'member', null);
		expect(authenticateToken(`Bearer ${token}`)).toBe('inactive');
	});
});

describe('REST API', () => {
	it('authenticates and returns the error shape', async () => {
		const res = await call(me.GET);
		expect(res.status).toBe(401);
		expect(res.body).toEqual({
			error: { code: 'unauthenticated', message: expect.any(String) }
		});
		expect(res.headers.get('www-authenticate')).toContain('Bearer');
		const token = pat(member, ['tickets:read']);
		const ok = await call(me.GET, { token });
		expect(ok.status).toBe(200);
		expect(ok.body.data.user.username).toBe(member.username);
		expect(ok.body.data.token.kind).toBe('personal');
		expect(JSON.stringify(ok.body)).not.toContain(token);
		expect(ok.headers.get('x-ratelimit-limit')).toBeTruthy();
	});

	it('enforces scopes', async () => {
		const token = pat(member, ['tickets:read']);
		const res = await call(projects.GET, { token });
		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe('insufficient_scope');
		const created = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: { title: 'Nope', description: 'x' }
		});
		expect(created.status).toBe(403);
	});

	it('lists only projects the user can see and hides others as 404', async () => {
		const token = pat(member, ['projects:read', 'tickets:read']);
		const list = await call(projects.GET, { token });
		expect(list.body.data.map((p: { key: string }) => p.key)).toEqual(['API']);
		const hidden = await call(projectOne.GET, { token, params: { key: 'OTR' } });
		expect(hidden.status).toBe(404);
		expect(hidden.body.error.code).toBe('project_not_found');
		const missing = await call(projectOne.GET, { token, params: { key: 'NOPE' } });
		expect(missing.body).toEqual(hidden.body);
		const outsiderToken = pat(outsider, ['tickets:read']);
		expect((await call(tickets.GET, { token: outsiderToken, params: { key: 'API' } })).status).toBe(
			404
		);
	});

	it('project tokens never reach another project', async () => {
		const token = prj(['tickets:read', 'tickets:create']);
		const list = await call(projects.GET, { token });
		expect(list.body.data.map((p: { key: string }) => p.key)).toEqual(['API']);
		expect((await call(tickets.GET, { token, params: { key: 'OTR' } })).status).toBe(404);
		expect(
			(
				await call(tickets.POST, {
					token,
					method: 'POST',
					params: { key: 'OTR' },
					body: { title: 'Cross project', description: 'x' }
				})
			).status
		).toBe(404);
		// Member lists are personal-token only.
		expect((await call(members.GET, { token, params: { key: 'API' } })).status).toBe(403);
	});

	it('creates, reads, filters and paginates tickets', async () => {
		const token = pat(member, ['tickets:read', 'tickets:write']);
		const created = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: { title: 'From CI', description: 'Build 12 failed', type: 'bug' }
		});
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({
			key: 'API-1',
			title: 'From CI',
			status: 'open',
			source: 'api',
			description_text: 'Build 12 failed'
		});
		for (let i = 2; i <= 5; i++)
			createTicket(member, access(member, fresh()), input(`Ticket ${i}`));
		const page1 = await call(tickets.GET, {
			token,
			params: { key: 'API' },
			path: '/api/v1/projects/API/tickets?limit=2'
		});
		expect(page1.body.data.map((t: { number: number }) => t.number)).toEqual([5, 4]);
		expect(page1.body.meta.next_cursor).toBeTruthy();
		const page2 = await call(tickets.GET, {
			token,
			params: { key: 'API' },
			path: `/api/v1/projects/API/tickets?limit=2&cursor=${page1.body.meta.next_cursor}`
		});
		expect(page2.body.data.map((t: { number: number }) => t.number)).toEqual([3, 2]);
		const page3 = await call(tickets.GET, {
			token,
			params: { key: 'API' },
			path: `/api/v1/projects/API/tickets?limit=2&cursor=${page2.body.meta.next_cursor}`
		});
		expect(page3.body.meta.next_cursor).toBeNull();
		const bad = await call(tickets.GET, {
			token,
			params: { key: 'API' },
			path: '/api/v1/projects/API/tickets?status=nope'
		});
		expect(bad.status).toBe(400);
		expect(bad.body.error.code).toBe('invalid_filter');
		expect(
			(
				await call(tickets.GET, {
					token,
					params: { key: 'API' },
					path: '/api/v1/projects/API/tickets?limit=500'
				})
			).status
		).toBe(400);
		expect(
			(
				await call(tickets.GET, {
					token,
					params: { key: 'API' },
					path: '/api/v1/projects/API/tickets?cursor=garbage'
				})
			).status
		).toBe(400);
		const filtered = await call(tickets.GET, {
			token,
			params: { key: 'API' },
			path: `/api/v1/projects/API/tickets?reporter=${member.username}&status=open`
		});
		expect(filtered.body.data).toHaveLength(5);
		const one = await call(ticketOne.GET, { token, params: { key: 'API', number: '1' } });
		expect(one.body.data.key).toBe('API-1');
		expect(
			(await call(ticketOne.GET, { token, params: { key: 'API', number: '99' } })).status
		).toBe(404);
	});

	it('validates ticket input and rejects unknown fields', async () => {
		const token = pat(member, ['tickets:write']);
		const short = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: { title: 'x', description: 'y' }
		});
		expect(short.status).toBe(422);
		expect(short.body.error.code).toBe('validation_failed');
		const extra = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: { title: 'Valid title', description: 'y', reporter_id: 1 }
		});
		expect(extra.status).toBe(422);
		const text = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: 'x',
			headers: { 'content-type': 'text/plain' }
		});
		expect(text.status).toBe(415);
		const xss = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: {
				title: 'Safe title',
				description_html: '<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>'
			}
		});
		expect(xss.status).toBe(201);
		expect(xss.body.data.description_html).not.toMatch(/script|onerror/);
	});

	it('honours Idempotency-Key on ticket creation', async () => {
		const token = pat(member, ['tickets:write']);
		const send = (body: unknown) =>
			call(tickets.POST, {
				token,
				method: 'POST',
				params: { key: 'API' },
				body,
				headers: { 'idempotency-key': 'build-4711' }
			});
		const first = await send({ title: 'Once only', description: 'x' });
		const second = await send({ title: 'Once only', description: 'x' });
		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(second.body).toEqual(first.body);
		expect(second.headers.get('idempotent-replayed')).toBe('true');
		expect(getDb().select().from(schema.tickets).all()).toHaveLength(1);
		const reused = await send({ title: 'Different', description: 'x' });
		expect(reused.status).toBe(422);
		expect(reused.body.error.code).toBe('idempotency_key_reused');
		expect(pruneIdempotency(Date.now() + 2 * 864e5)).toBe(1);
	});

	it('patches tickets with the same permissions as the web app', async () => {
		const staffToken = pat(owner, ['tickets:read', 'tickets:write']);
		const memberToken = pat(member, ['tickets:write']);
		createTicket(member, access(member, fresh()), input('Patch me'));
		createLabel(project.id, 'backend', 'indigo');
		const denied = await call(ticketOne.PATCH, {
			token: memberToken,
			method: 'PATCH',
			params: { key: 'API', number: '1' },
			body: { status: 'in_progress' }
		});
		expect(denied.status).toBe(403);
		const res = await call(ticketOne.PATCH, {
			token: staffToken,
			method: 'PATCH',
			params: { key: 'API', number: '1' },
			body: {
				status: 'in_progress',
				priority: 'high',
				assignee: owner.username,
				labels: ['backend']
			}
		});
		expect(res.body.error ?? null).toBeNull();
		expect(res.status).toBe(200);
		expect(res.body.data).toMatchObject({
			status: 'in_progress',
			priority: 'high',
			assignee: { username: owner.username },
			labels: ['backend']
		});
		const unknown = await call(ticketOne.PATCH, {
			token: staffToken,
			method: 'PATCH',
			params: { key: 'API', number: '1' },
			body: { priority: 'low', labels: ['nope'] }
		});
		expect(unknown.status).toBe(422);
		// All-or-nothing: the priority change was rolled back with the failed label change.
		expect(getTicket(project.id, 1)!.priority).toBe('high');
		const audits = getDb().select().from(schema.auditLogs).all();
		expect(audits.some((a) => a.action === 'api.ticket_updated')).toBe(true);
	});

	it('enforces workflow transitions through the API', async () => {
		const token = pat(owner, ['tickets:write']);
		createTicket(member, access(member, fresh()), input('Flow'));
		saveWorkflow(
			owner.id,
			access(owner, fresh()),
			{
				...DEFAULT_WORKFLOW,
				transitions: { open: ['in_progress'], in_progress: ['completed'], completed: ['open'] }
			},
			null
		);
		const res = await call(ticketOne.PATCH, {
			token,
			method: 'PATCH',
			params: { key: 'API', number: '1' },
			body: { status: 'completed' }
		});
		expect(res.status).toBe(422);
		expect(getTicket(project.id, 1)!.status).toBe('open');
	});

	it('hides internal notes from non-staff and lets staff post them', async () => {
		createTicket(member, access(member, fresh()), input('Comment me'));
		const staffToken = pat(owner, ['comments:read', 'comments:write']);
		const memberToken = pat(member, ['comments:read', 'comments:write']);
		const note = await call(comments.POST, {
			token: staffToken,
			method: 'POST',
			params: { key: 'API', number: '1' },
			body: { body: 'Secret plan', internal: true }
		});
		expect(note.status).toBe(201);
		await call(comments.POST, {
			token: memberToken,
			method: 'POST',
			params: { key: 'API', number: '1' },
			body: { body: 'Public reply' }
		});
		const asMember = await call(comments.GET, {
			token: memberToken,
			params: { key: 'API', number: '1' }
		});
		expect(asMember.body.data.map((c: { body_text: string }) => c.body_text)).toEqual([
			'Public reply'
		]);
		expect(JSON.stringify(asMember.body)).not.toContain('Secret plan');
		const asStaff = await call(comments.GET, {
			token: staffToken,
			params: { key: 'API', number: '1' }
		});
		expect(asStaff.body.data).toHaveLength(2);
		const memberNote = await call(comments.POST, {
			token: memberToken,
			method: 'POST',
			params: { key: 'API', number: '1' },
			body: { body: 'Sneaky', internal: true }
		});
		expect(memberNote.status).toBe(403);
	});

	it('limits staff-only metadata', async () => {
		const memberToken = pat(member, ['projects:read']);
		expect((await call(members.GET, { token: memberToken, params: { key: 'API' } })).status).toBe(
			403
		);
		expect(
			(await call(milestones.GET, { token: memberToken, params: { key: 'API' } })).status
		).toBe(403);
		createLabel(project.id, 'ui', 'indigo');
		const l = await call(labels.GET, { token: memberToken, params: { key: 'API' } });
		expect(l.body.data.map((x: { name: string }) => x.name)).toEqual(['ui']);
		const ownerToken = pat(owner, ['projects:read']);
		const m = await call(members.GET, { token: ownerToken, params: { key: 'API' } });
		expect(m.status).toBe(200);
		expect(JSON.stringify(m.body)).not.toContain('@example.com');
	});

	it('rate limits per token with headers and 429', async () => {
		process.env.API_RATE_LIMIT = '3';
		resetApiLimiters();
		try {
			const token = pat(member, ['tickets:read']);
			const results = [];
			for (let i = 0; i < 4; i++)
				results.push(await call(tickets.GET, { token, params: { key: 'API' } }));
			expect(results.slice(0, 3).every((r) => r.status === 200)).toBe(true);
			expect(results[2].headers.get('x-ratelimit-remaining')).toBe('0');
			expect(results[3].status).toBe(429);
			expect(results[3].body.error.code).toBe('rate_limited');
			expect(results[3].headers.get('retry-after')).toBeTruthy();
		} finally {
			delete process.env.API_RATE_LIMIT;
			resetApiLimiters();
		}
	});

	it('archived projects reject writes', async () => {
		createTicket(member, access(member, fresh()), input('Before archive'));
		const token = pat(owner, ['tickets:write', 'tickets:read']);
		getDb()
			.update(schema.projects)
			.set({ archivedAt: new Date() })
			.where(eq(schema.projects.id, project.id))
			.run();
		const res = await call(tickets.POST, {
			token,
			method: 'POST',
			params: { key: 'API' },
			body: { title: 'After archive', description: 'x' }
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect((await call(tickets.GET, { token, params: { key: 'API' } })).status).toBe(200);
	});

	it('describes itself as OpenAPI 3.1', () => {
		const doc = openApiDocument('https://tikket.example.com');
		expect(doc.openapi).toBe('3.1.0');
		expect(Object.keys(doc.paths)).toContain('/api/v1/projects/{key}/tickets');
		expect(doc.paths['/api/v1/projects/{key}/tickets'].post).toBeTruthy();
		expect(doc.info.description).toMatch(/v2/);
	});

	it('project tokens never see or write internal notes', async () => {
		createTicket(member, access(member, fresh()), input('Notes'));
		const staffToken = pat(owner, ['comments:write']);
		await call(comments.POST, {
			token: staffToken,
			method: 'POST',
			params: { key: 'API', number: '1' },
			body: { body: 'Owner-only plan', internal: true }
		});
		const token = prj(['tickets:read', 'comments:create']);
		const list = await call(comments.GET, { token, params: { key: 'API', number: '1' } });
		expect(list.status).toBe(200);
		expect(list.body.data).toEqual([]);
		const write = await call(comments.POST, {
			token,
			method: 'POST',
			params: { key: 'API', number: '1' },
			body: { body: 'CI note', internal: true }
		});
		expect(write.status).toBe(403);
	});

	it('failed-auth IP limiting never blocks valid tokens or counts missing headers', async () => {
		const token = pat(member, ['tickets:read']);
		for (let i = 0; i < 40; i++) await call(me.GET);
		expect((await call(me.GET, { token })).status).toBe(200);
		let last = 0;
		for (let i = 0; i < 31; i++)
			last = (await call(me.GET, { token: `tkt_pat_${'x'.repeat(40)}` })).status;
		expect(last).toBe(429);
		// A valid token from the same address still works.
		expect((await call(me.GET, { token })).status).toBe(200);
	});
});
