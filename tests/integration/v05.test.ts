import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import '../../src/lib/server/outbound';
import { drainQueue } from '../../src/lib/server/outbound';
import { claimJobs, queueStats } from '../../src/lib/server/outbound/queue';
import {
	changePriority,
	changeStatus,
	createTicket,
	getTicket
} from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { removeMember } from '../../src/lib/server/services/projects';
import { getEmailPrefs, setEmailPrefs } from '../../src/lib/server/email/notifications';
import {
	getStoredSmtp,
	saveSmtp,
	smtpForDisplay,
	type SmtpForm
} from '../../src/lib/server/email/config';
import { setTransportOverride, type Message } from '../../src/lib/server/email/mailer';
import { requestPasswordResetEmail, sendTestEmail } from '../../src/lib/server/email/account';
import {
	createHook,
	deleteHook,
	hookCredentials,
	listHooks,
	rotateHookSecret
} from '../../src/lib/server/integrations/hooks';
import {
	sendTestDelivery,
	setDeliveryResolver,
	setDeliveryTimeout,
	signPayload
} from '../../src/lib/server/integrations/delivery';
import {
	connectRepository,
	getConnection,
	handleGithubWebhook,
	ticketDevLinks,
	updateConnection
} from '../../src/lib/server/integrations/github';
import {
	canViewRoadmap,
	roadmapFor,
	roadmapSettings,
	saveRoadmapSettings
} from '../../src/lib/server/services/roadmap';
import { findProjectById } from '../../src/lib/server/authz';
import {
	personalExport,
	projectCsvStream,
	projectJsonStream,
	requireExporter
} from '../../src/lib/server/services/export';
import { checkStoredSecrets } from '../../src/lib/server/stored-secrets';
import { DEFAULT_ROADMAP_SETTINGS } from '../../src/lib/shared/constants';

const KEY = crypto.randomBytes(32).toString('base64');
let owner: User, member: User, outsider: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string, type: 'bug' | 'feature' = 'bug') => ({
	type,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: `${title} description`,
	context: {}
});
const jobs = () => getDb().select().from(schema.outboundJobs).all();

beforeEach(async () => {
	freshDb();
	process.env.ENCRYPTION_KEY = KEY;
	process.env.ORIGIN = 'https://tikket.example.com';
	owner = await makeUser('user', `own${Date.now()}`);
	member = await makeUser();
	outsider = await makeUser();
	project = makeProject(owner, { key: 'SPL', name: 'Spool' });
	join(owner, project, member);
});
afterEach(() => {
	delete process.env.ENCRYPTION_KEY;
	delete process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS;
	delete process.env.ORIGIN;
	setTransportOverride(null);
	setDeliveryResolver(undefined);
	setDeliveryTimeout();
});

// ── Email ──────────────────────────────────────────────────────────────────

const smtp: SmtpForm = {
	enabled: true,
	host: 'smtp.example.com',
	port: 587,
	security: 'starttls',
	username: 'mailer',
	fromName: 'Tikket',
	fromAddress: 'tikket@example.com',
	replyTo: '',
	timeoutSec: 10
};

describe('email notifications', () => {
	let sent: Message[];
	beforeEach(() => {
		sent = [];
		setTransportOverride(async (_cfg, message) => {
			sent.push(message);
		});
	});

	it('does nothing while email is not configured', async () => {
		const t = createTicket(member, access(member, fresh()), input('Quiet'));
		addComment(owner, access(owner, fresh()), t, { html: '<p>hi</p>', text: 'hi' });
		expect(jobs().filter((j) => j.kind === 'email')).toEqual([]);
		await drainQueue();
		expect(sent).toEqual([]);
	});

	it('stores the SMTP password encrypted and never returns it', () => {
		saveSmtp(owner.id, { ...smtp, password: 'super-secret-pw' }, null);
		const stored = getStoredSmtp()!;
		expect(stored.passwordEnc).toBeTruthy();
		expect(JSON.stringify(stored)).not.toContain('super-secret-pw');
		const display = smtpForDisplay()!;
		expect(display.hasPassword).toBe(true);
		expect(JSON.stringify(display)).not.toContain('super-secret-pw');
		expect('password' in display).toBe(false);
		// An empty password keeps the stored one; clearPassword removes it.
		saveSmtp(owner.id, { ...smtp, password: '' }, null);
		expect(getStoredSmtp()!.passwordEnc).toBe(stored.passwordEnc);
		saveSmtp(owner.id, { ...smtp, clearPassword: true }, null);
		expect(getStoredSmtp()!.passwordEnc).toBeNull();
		const audit = getDb().select().from(schema.auditLogs).all();
		expect(JSON.stringify(audit)).not.toContain('super-secret-pw');
	});

	it('emails followers per their preferences, with aggregation', async () => {
		saveSmtp(owner.id, smtp, null);
		const t = createTicket(member, access(member, fresh()), input('Playback resets'));
		addComment(owner, access(owner, fresh()), t, {
			html: '<p>Looking</p>',
			text: 'Looking into it'
		});
		addComment(owner, access(owner, fresh()), t, { html: '<p>Again</p>', text: 'Again' });
		await drainQueue();
		const toMember = sent.filter((m) => m.to === member.email);
		// Two comments within the hour → one email (aggregation), owner is the actor → none.
		expect(toMember).toHaveLength(1);
		expect(toMember[0].subject).toContain('[SPL-1] Playback resets');
		expect(toMember[0].html).toContain('Looking into it');
		expect(toMember[0].text).toContain('https://tikket.example.com/p/spl/tickets/1');
		expect(toMember[0].html).toContain('/settings/notifications');

		// Opting out of comment emails stops them; in-app stays independent.
		setEmailPrefs(member.id, { ...getEmailPrefs(member), comment: false });
		const t2 = createTicket(member, access(member, fresh()), input('Second'));
		addComment(owner, access(owner, fresh()), t2, { html: '<p>x</p>', text: 'x' });
		sent = [];
		await drainQueue();
		expect(sent.filter((m) => m.to === member.email)).toEqual([]);
	});

	it('never leaks internal notes and re-checks membership at send time', async () => {
		saveSmtp(owner.id, smtp, null);
		const mod = await makeUser();
		join(owner, project, mod, 'moderator');
		const t = createTicket(member, access(member, fresh()), input('Private stuff'));
		changePriority(owner, access(owner, fresh()), t, 'high'); // member doesn't follow updates by email
		addComment(
			owner,
			access(owner, fresh()),
			getTicket(project.id, 1)!,
			{
				html: '<p>secret note</p>',
				text: 'secret internal reasoning @' + member.username
			},
			[],
			{ internal: true }
		);
		await drainQueue();
		expect(sent.some((m) => m.to === member.email && /internal/i.test(m.subject))).toBe(false);
		expect(sent.every((m) => !m.html.includes('secret internal reasoning'))).toBe(true);

		// A status change is queued, then the member is removed before delivery.
		sent = [];
		changeStatus(owner, access(owner, fresh()), getTicket(project.id, 1)!, {
			status: 'planned',
			note: null
		});
		expect(jobs().some((j) => j.kind === 'email' && j.status === 'pending')).toBe(true);
		removeMember(owner.id, fresh(), member.id, null);
		await drainQueue();
		expect(sent.filter((m) => m.to === member.email)).toEqual([]);
	});

	it('keeps the ticket action when SMTP fails, retries, then gives up', async () => {
		saveSmtp(owner.id, smtp, null);
		setTransportOverride(async () => {
			const err = new Error('connect ECONNREFUSED') as Error & { code: string };
			err.code = 'ECONNECTION';
			throw (await import('../../src/lib/server/email/mailer')).classify(err);
		});
		const t = createTicket(member, access(member, fresh()), input('Still saved'));
		changeStatus(owner, access(owner, fresh()), t, { status: 'completed', note: null });
		expect(getTicket(project.id, 1)!.status).toBe('completed');
		await drainQueue(1);
		const job = jobs().find((j) => j.kind === 'email')!;
		expect(job).toMatchObject({ status: 'pending', attempts: 1 });
		expect(job.lastError).toMatch(/connect/);
		expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
		// Out of attempts → dead, never an endless loop.
		getDb()
			.update(schema.outboundJobs)
			.set({ attempts: job.maxAttempts - 1, nextAttemptAt: new Date(0) })
			.where(eq(schema.outboundJobs.id, job.id))
			.run();
		await drainQueue(1);
		expect(jobs().find((j) => j.id === job.id)!.status).toBe('dead');
		expect(queueStats('email').dead).toBe(1);
	});

	it('sends test emails and self-service reset links without storing the token', async () => {
		saveSmtp(owner.id, smtp, null);
		expect(await sendTestEmail('admin@example.com')).toMatchObject({ ok: true });
		expect(getStoredSmtp()!.lastTest).toMatchObject({ ok: true });
		requestPasswordResetEmail(member.email.toUpperCase());
		requestPasswordResetEmail(member.username); // deduplicated within 10 minutes
		requestPasswordResetEmail('nobody@example.com'); // silently ignored
		const resetJobs = jobs().filter((j) => j.payload.template === 'password_reset');
		expect(resetJobs).toHaveLength(1);
		expect(JSON.stringify(resetJobs[0].payload)).not.toMatch(/reset\//);
		await drainQueue();
		const mail = sent.find((m) => m.to === member.email)!;
		expect(mail.text).toMatch(/https:\/\/tikket\.example\.com\/reset\/[A-Za-z0-9_-]{20,}/);
	});
});

// ── Webhooks ───────────────────────────────────────────────────────────────

interface Received {
	headers: http.IncomingHttpHeaders;
	body: string;
}
let server: http.Server;
let port = 0;
let behaviour: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let received: Received[] = [];

beforeAll(async () => {
	server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			received.push({ headers: req.headers, body });
			behaviour(req, res);
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('generic webhooks', () => {
	beforeEach(() => {
		received = [];
		behaviour = (_req, res) => res.writeHead(204).end();
		process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS = 'true';
	});
	const create = (events = ['ticket.created', 'comment.created', 'ticket.status_changed']) =>
		createHook(
			owner.id,
			access(owner, fresh()),
			'webhook',
			{ name: 'Bot', url: `http://127.0.0.1:${port}/hook?token=abc`, events, enabled: true },
			null
		);

	it('delivers signed, versioned events and keeps secrets out of listings', async () => {
		const { hook, secret } = create();
		expect(secret).toMatch(/^whsec_/);
		const listed = listHooks(project.id, 'webhook');
		expect(JSON.stringify(listed)).not.toContain('token=abc');
		expect(JSON.stringify(listed)).not.toContain(secret!);
		expect(listed[0].urlHint).toBe(`http://127.0.0.1:${port}/hook?…`);
		expect(hook.urlEnc).not.toContain('127.0.0.1');

		const t = createTicket(member, access(member, fresh()), input('Hooked'));
		addComment(owner, access(owner, fresh()), t, { html: '<p>c</p>', text: 'public reply' });
		addComment(owner, access(owner, fresh()), t, { html: '<p>n</p>', text: 'internal only' }, [], {
			internal: true
		});
		await drainQueue();
		expect(received).toHaveLength(2);
		const [first, second] = received;
		const env = JSON.parse(first.body);
		expect(env).toMatchObject({
			version: '1',
			event: 'ticket.created',
			project: { key: 'SPL', name: 'Spool' },
			data: { ticket: { key: 'SPL-1', title: 'Hooked', type: 'bug', status: 'open' } }
		});
		expect(env.id).toMatch(/^evt_/);
		expect(first.headers['tikket-event']).toBe('ticket.created');
		expect(first.headers['tikket-delivery']).toBe(env.id);
		const ts = Number(first.headers['tikket-timestamp']);
		expect(Math.abs(Date.now() / 1000 - ts)).toBeLessThan(60);
		expect(first.headers['tikket-signature']).toBe(`v1=${signPayload(secret!, ts, first.body)}`);
		expect(JSON.parse(second.body).data.comment.body).toBe('public reply');
		expect(received.some((r) => r.body.includes('internal only'))).toBe(false);
		const deliveries = getDb().select().from(schema.hookDeliveries).all();
		expect(deliveries.every((d) => d.success && d.statusCode === 204)).toBe(true);
	});

	it('retries 5xx and 429, but not other 4xx', async () => {
		create(['ticket.created']);
		behaviour = (_req, res) => res.writeHead(500).end('boom');
		createTicket(member, access(member, fresh()), input('A'));
		await drainQueue(1);
		let job = jobs().find((j) => j.kind === 'webhook')!;
		expect(job).toMatchObject({ status: 'pending', attempts: 1 });
		expect(job.lastError).toBe('HTTP 500: boom');

		behaviour = (_req, res) => res.writeHead(429, { 'retry-after': '120' }).end();
		getDb()
			.update(schema.outboundJobs)
			.set({ nextAttemptAt: new Date(0) })
			.run();
		await drainQueue(1);
		job = jobs().find((j) => j.id === job.id)!;
		expect(job.status).toBe('pending');
		expect(job.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(100_000);

		behaviour = (_req, res) => res.writeHead(400).end('bad');
		getDb()
			.update(schema.outboundJobs)
			.set({ nextAttemptAt: new Date(0) })
			.run();
		await drainQueue(1);
		expect(jobs().find((j) => j.id === job.id)!.status).toBe('dead');
		expect(received).toHaveLength(3);
		expect(new Set(received.map((r) => r.headers['tikket-delivery'])).size).toBe(1); // same event id
		expect(received.map((r) => r.headers['tikket-attempt'])).toEqual(['1', '2', '3']);
	});

	it('treats timeouts as temporary', async () => {
		create(['ticket.created']);
		setDeliveryTimeout(200);
		behaviour = (_req, res) => setTimeout(() => res.writeHead(204).end(), 1000);
		createTicket(member, access(member, fresh()), input('Slow'));
		await drainQueue(1);
		const job = jobs().find((j) => j.kind === 'webhook')!;
		expect(job.status).toBe('pending');
		expect(job.lastError).toMatch(/too long/);
	});

	it('blocks private targets, DNS rebinding and redirects', async () => {
		delete process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS;
		expect(() =>
			createHook(
				owner.id,
				access(owner, fresh()),
				'webhook',
				{ name: 'x', url: `http://127.0.0.1:${port}/`, events: ['ticket.created'], enabled: true },
				null
			)
		).toThrow(/not publicly reachable/);
		// A public-looking host that resolves to a private address is refused at delivery time.
		createHook(
			owner.id,
			access(owner, fresh()),
			'webhook',
			{
				name: 'y',
				url: `http://hooks.example.com:${port}/`,
				events: ['ticket.created'],
				enabled: true
			},
			null
		);
		setDeliveryResolver(async () => ['93.184.216.34', '127.0.0.1']);
		createTicket(member, access(member, fresh()), input('Rebind'));
		await drainQueue(1);
		const job = jobs().find((j) => j.kind === 'webhook')!;
		expect(job.status).toBe('dead'); // policy rejection: permanent
		expect(job.lastError).toMatch(/private or reserved/);
		expect(received).toEqual([]);

		// Redirects are never followed (e.g. to the metadata service).
		process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS = 'true';
		setDeliveryResolver(undefined);
		const { hook } = create(['ticket.created']);
		behaviour = (_req, res) =>
			res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
		const result = await sendTestDelivery(
			getDb().select().from(schema.projectHooks).where(eq(schema.projectHooks.id, hook.id)).get()!,
			fresh()
		);
		expect(result).toMatchObject({ ok: false, statusCode: 302, retryable: false });
		expect(result.error).toMatch(/redirects are not followed/);
		expect(received).toHaveLength(1);
	});

	it('rotates the signing secret and deletes cleanly', async () => {
		const { hook, secret } = create(['ticket.created']);
		const next = rotateHookSecret(owner.id, access(owner, fresh()), hook.id, null);
		expect(next).not.toBe(secret);
		createTicket(member, access(member, fresh()), input('Rotated'));
		await drainQueue();
		const r = received[0];
		const ts = Number(r.headers['tikket-timestamp']);
		expect(r.headers['tikket-signature']).toBe(`v1=${signPayload(next, ts, r.body)}`);
		expect(r.headers['tikket-signature']).not.toBe(`v1=${signPayload(secret!, ts, r.body)}`);
		deleteHook(owner.id, access(owner, fresh()), 'webhook', hook.id, null);
		expect(listHooks(project.id)).toEqual([]);
		expect(getDb().select().from(schema.hookDeliveries).all()).toEqual([]);
	});

	it('lets only project owners manage hooks', () => {
		expect(() =>
			createHook(
				member.id,
				access(member, fresh()),
				'webhook',
				{ name: 'x', url: `http://127.0.0.1:${port}/`, events: ['ticket.created'], enabled: true },
				null
			)
		).toThrow(/owners/);
	});
});

// ── Discord ────────────────────────────────────────────────────────────────

describe('Discord', () => {
	const url =
		'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123';
	it('stores the URL encrypted, filters events and never sends internal notes', () => {
		const { hook } = createHook(
			owner.id,
			access(owner, fresh()),
			'discord',
			{ name: '#bugs', url, events: ['new_bug', 'public_comment'], enabled: true },
			null
		);
		expect(hook.urlEnc).not.toContain('abcdefghij');
		expect(hookCredentials(hook).url).toBe(url);
		expect(JSON.stringify(listHooks(project.id))).not.toContain('abcdefghij');

		createTicket(member, access(member, fresh()), input('Feature idea', 'feature'));
		const bug = createTicket(member, access(member, fresh()), {
			...input('Crash'),
			descriptionText: 'd'.repeat(3000)
		});
		addComment(owner, access(owner, fresh()), bug, { html: '<p>n</p>', text: 'internal' }, [], {
			internal: true
		});
		addComment(owner, access(owner, fresh()), bug, { html: '<p>p</p>', text: 'public @everyone' });
		const discord = jobs().filter((j) => j.kind === 'discord');
		expect(discord.map((j) => j.payload.event)).toEqual(['ticket.created', 'comment.created']);
		const created = discord[0].payload.message as {
			embeds: { title: string; description: string }[];
		};
		expect(created.embeds[0].title).toBe('SPL-2 · Crash');
		expect(created.embeds[0].description.length).toBeLessThanOrEqual(300 + 50);
		expect(JSON.stringify(discord)).not.toContain('internal');
		expect(JSON.stringify(discord[1].payload)).toContain('@​everyone');
	});

	it('rejects non-Discord URLs', () => {
		expect(() =>
			createHook(
				owner.id,
				access(owner, fresh()),
				'discord',
				{
					name: 'x',
					url: 'https://example.com/api/webhooks/1/2',
					events: ['new_ticket'],
					enabled: true
				},
				null
			)
		).toThrow(/Discord webhook URL/);
	});
});

// ── Secrets at start-up ────────────────────────────────────────────────────

describe('stored secrets', () => {
	it('refuses to start without the key once secrets exist, and rotates keys', () => {
		expect(checkStoredSecrets()).toEqual({ rotated: 0, unreadable: [] });
		createHook(
			owner.id,
			access(owner, fresh()),
			'discord',
			{
				name: 'x',
				url: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
				events: ['new_ticket'],
				enabled: true
			},
			null
		);
		delete process.env.ENCRYPTION_KEY;
		expect(() => checkStoredSecrets()).toThrow(/ENCRYPTION_KEY is not set/);
		const next = crypto.randomBytes(32).toString('base64');
		process.env.ENCRYPTION_KEY = next;
		expect(checkStoredSecrets().unreadable).toHaveLength(1);
		process.env.ENCRYPTION_KEY_PREVIOUS = KEY;
		expect(checkStoredSecrets()).toEqual({ rotated: 1, unreadable: [] });
		delete process.env.ENCRYPTION_KEY_PREVIOUS;
		expect(checkStoredSecrets()).toEqual({ rotated: 0, unreadable: [] });
	});
});

describe('lost encryption key recovery', () => {
	it('forget-secrets.js removes unreadable secrets so Tikket can start without the old key', async () => {
		const { execFileSync } = await import('node:child_process');
		const path = await import('node:path');
		const dir = freshDb();
		owner = await makeUser();
		project = makeProject(owner, { key: 'REC' });
		createHook(
			owner.id,
			access(owner, fresh()),
			'discord',
			{
				name: 'x',
				url: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
				events: ['new_ticket'],
				enabled: true
			},
			null
		);
		connectRepository(
			owner.id,
			access(owner, fresh()),
			{ repository: 'a/b', mergeAction: 'none' },
			null
		);
		saveSmtp(owner.id, { ...smtp, password: 'pw' }, null);
		delete process.env.ENCRYPTION_KEY;
		expect(() => checkStoredSecrets()).toThrow(/ENCRYPTION_KEY is not set/);
		const out = execFileSync('node', ['scripts/forget-secrets.js', '--yes'], {
			env: { ...process.env, DATABASE_PATH: path.join(dir, 'test.db') },
			encoding: 'utf8'
		});
		expect(out).toMatch(
			/1 Discord\/webhook destination\(s\), 1 GitHub connection\(s\) and the SMTP password/
		);
		expect(checkStoredSecrets()).toEqual({ rotated: 0, unreadable: [] });
		expect(listHooks(project.id)[0]).toMatchObject({ enabled: false });
		expect(getStoredSmtp()!.passwordEnc).toBeNull();
	});
});

// ── GitHub ─────────────────────────────────────────────────────────────────

describe('GitHub', () => {
	let secret: string;
	let publicId: string;
	let seq = 0;
	beforeEach(() => {
		const r = connectRepository(
			owner.id,
			access(owner, fresh()),
			{ repository: 'aljaz-h/spool', mergeAction: 'none' },
			null
		);
		secret = r.secret;
		publicId = r.connection.publicId;
		createTicket(member, access(member, fresh()), input('First'));
		createTicket(member, access(member, fresh()), input('Second'));
	});
	const send = (
		event: string,
		payload: object,
		opts: { secret?: string; delivery?: string } = {}
	) => {
		const body = Buffer.from(JSON.stringify(payload));
		const sig = `sha256=${crypto
			.createHmac('sha256', opts.secret ?? secret)
			.update(body)
			.digest('hex')}`;
		return handleGithubWebhook(
			publicId,
			{ event, delivery: opts.delivery ?? `d-${++seq}-${Date.now()}`, signature: sig },
			body
		);
	};
	const repository = { id: 4242, full_name: 'aljaz-h/spool' };
	const pr = ({ action = 'opened', ...extra }: { action?: string; [k: string]: unknown } = {}) => ({
		action,
		repository,
		pull_request: {
			number: 182,
			title: 'Fix playback progress (SPL-1)',
			body: 'Also touches SPL-2 and OTHER-9',
			state: 'open',
			merged: false,
			user: { login: 'aljaz' },
			updated_at: '2026-10-01T10:00:00Z',
			...extra
		}
	});

	it('rejects bad signatures, other repositories and replays', async () => {
		expect((await send('ping', { repository }, { secret: 'wrong' })).status).toBe(401);
		expect(getConnection(project.id)!.lastError).toMatch(/invalid signature/i);
		expect((await send('ping', { repository: { id: 1, full_name: 'evil/spool' } })).status).toBe(
			202
		);
		expect((await send('ping', { repository }, { delivery: 'same-delivery-1' })).status).toBe(200);
		expect(getConnection(project.id)!.repoId).toBe(4242);
		const replay = await send('ping', { repository }, { delivery: 'same-delivery-1' });
		expect(replay.message).toBe('Already processed');
		// Once the repository id is known, a renamed impostor with another id is ignored.
		expect(
			(await send('push', { repository: { id: 999, full_name: 'aljaz-h/spool' }, commits: [] }))
				.status
		).toBe(202);
		expect(
			(
				await handleGithubWebhook(
					'unknown-id-123',
					{ event: 'ping', delivery: 'x', signature: '' },
					Buffer.from('{}')
				)
			).status
		).toBe(404);
	});

	it('links commits and pull requests by this project’s keys only', async () => {
		const sha = 'a'.repeat(40);
		await send('push', {
			repository,
			commits: [
				{
					id: sha,
					message: 'fix: prevent progress reset (SPL-1)\n\nlong body',
					url: 'https://evil/x',
					author: { username: 'aljaz' }
				},
				{ id: 'b'.repeat(40), message: 'chore: OTHER-1 SPL-99', author: { name: 'Bot' } }
			]
		});
		const t1 = getTicket(project.id, 1)!;
		let links = ticketDevLinks(t1.id);
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({
			kind: 'commit',
			ref: sha,
			title: 'fix: prevent progress reset (SPL-1)',
			url: `https://github.com/aljaz-h/spool/commit/${sha}`,
			author: 'aljaz'
		});
		await send('pull_request', pr());
		links = ticketDevLinks(t1.id);
		expect(links.find((l) => l.kind === 'pull_request')).toMatchObject({
			ref: '182',
			state: 'open',
			author: 'aljaz',
			url: 'https://github.com/aljaz-h/spool/pull/182'
		});
		expect(ticketDevLinks(getTicket(project.id, 2)!.id)).toHaveLength(1);
		// Merge with automation off (default): states update, tickets don't move.
		await send('pull_request', pr({ state: 'closed', merged: true, action: 'closed' }));
		expect(ticketDevLinks(t1.id).find((l) => l.kind === 'pull_request')!.state).toBe('merged');
		expect(getTicket(project.id, 1)!.status).toBe('open');
	});

	it('completes linked tickets on merge only when configured', async () => {
		updateConnection(owner.id, access(owner, fresh()), { mergeAction: 'completed' }, null);
		await send('pull_request', pr());
		await send('pull_request', pr({ action: 'closed', state: 'closed', merged: true }));
		const t1 = getTicket(project.id, 1)!;
		expect(t1.status).toBe('completed');
		const activity = getDb()
			.select()
			.from(schema.ticketActivity)
			.where(eq(schema.ticketActivity.ticketId, t1.id))
			.all()
			.find((a) => a.type === 'status')!;
		expect(activity.actorId).toBeNull();
		expect(activity.data).toMatchObject({
			to: 'completed',
			automation: { source: 'github', pr: 182 }
		});
		// Closed without merging: nothing happens.
		updateConnection(owner.id, access(owner, fresh()), { mergeAction: 'in_progress' }, null);
		await send(
			'pull_request',
			pr({ number: 183, title: 'SPL-2', action: 'closed', state: 'closed', merged: false })
		);
		expect(getTicket(project.id, 2)!.status).not.toBe('in_progress');
	});
});

// ── Roadmap ────────────────────────────────────────────────────────────────

describe('roadmap visibility', () => {
	beforeEach(() => {
		createTicket(member, access(member, fresh()), input('Planned one'));
		changeStatus(owner, access(owner, fresh()), getTicket(project.id, 1)!, {
			status: 'planned',
			note: null
		});
		changePriority(owner, access(owner, fresh()), getTicket(project.id, 1)!, 'critical');
	});

	it('keeps the previous behaviour by default and never exposes planning details', () => {
		expect(roadmapSettings(fresh())).toEqual(DEFAULT_ROADMAP_SETTINGS);
		expect(canViewRoadmap(access(member, fresh()), roadmapSettings(fresh()))).toBe(true);
		expect(canViewRoadmap(access(outsider, fresh()), roadmapSettings(fresh()))).toBe(false); // private project
		const view = roadmapFor(fresh(), roadmapSettings(fresh()), false);
		const item = view.columns.planned[0];
		expect(item).toMatchObject({
			title: 'Planned one',
			priority: null,
			assignee: null,
			milestone: null
		});
		expect(item.voteCount).toBe(0);
		expect(view.releases).toEqual([]);
		expect(roadmapFor(fresh(), roadmapSettings(fresh()), true).columns.planned[0].priority).toBe(
			'critical'
		);
	});

	it('honours staff-only, members-only and field toggles', () => {
		saveRoadmapSettings(
			owner.id,
			access(owner, fresh()),
			{ ...DEFAULT_ROADMAP_SETTINGS, audience: 'staff' },
			null
		);
		expect(canViewRoadmap(access(member, fresh()), roadmapSettings(fresh()))).toBe(false);
		expect(canViewRoadmap(access(owner, fresh()), roadmapSettings(fresh()))).toBe(true);
		saveRoadmapSettings(
			owner.id,
			access(owner, fresh()),
			{
				...DEFAULT_ROADMAP_SETTINGS,
				audience: 'members',
				showPriorities: true,
				showVotes: false,
				showReleaseDates: true
			},
			null
		);
		const s = roadmapSettings(fresh());
		expect(s.showReleaseDates).toBe(false); // requires releases
		expect(canViewRoadmap(access(member, fresh()), s)).toBe(true);
		const item = roadmapFor(fresh(), s, false).columns.planned[0];
		expect(item.priority).toBe('critical');
		expect(item.voteCount).toBeNull();
		expect(() =>
			saveRoadmapSettings(member.id, access(member, fresh()), DEFAULT_ROADMAP_SETTINGS, null)
		).toThrow(/owners/);
		const audit = getDb()
			.select()
			.from(schema.auditLogs)
			.all()
			.filter((a) => a.action === 'project.roadmap_visibility');
		expect(audit).toHaveLength(2);
	});
});

// ── Export ─────────────────────────────────────────────────────────────────

async function read(stream: ReadableStream<Uint8Array>) {
	return new Response(stream).text();
}

describe('export', () => {
	beforeEach(() => {
		const t = createTicket(member, access(member, fresh()), input('=cmd|"/c calc"!A1'));
		addComment(owner, access(owner, fresh()), t, { html: '<p>public</p>', text: 'public' });
		addComment(
			owner,
			access(owner, fresh()),
			t,
			{ html: '<p>staff</p>', text: 'staff only note' },
			[],
			{
				internal: true
			}
		);
		for (let i = 0; i < 120; i++) createTicket(member, access(member, fresh()), input(`Bulk ${i}`));
	});

	it('streams a versioned JSON export without internal notes or secrets', async () => {
		const json = JSON.parse(await read(projectJsonStream(fresh(), 'standard')));
		expect(json).toMatchObject({ format: 'tikket-project', version: 1, scope: 'standard' });
		expect(json.tickets).toHaveLength(121);
		expect(json.tickets[0].comments.map((c: { body_text: string }) => c.body_text)).toEqual([
			'public'
		]);
		const text = JSON.stringify(json);
		expect(text).not.toContain('staff only note');
		expect(text).not.toContain('password');
		expect(text).not.toContain('@example.com');
		expect(json.members.map((m: { role: string }) => m.role).sort()).toEqual(['member', 'owner']);
	});

	it('includes internal notes only in the labelled staff export', async () => {
		const json = JSON.parse(await read(projectJsonStream(fresh(), 'staff')));
		expect(json.scope).toBe('staff');
		expect(json.notice).toMatch(/STAFF EXPORT/);
		expect(JSON.stringify(json)).toContain('staff only note');
	});

	it('writes a formula-safe CSV and enforces authorization', async () => {
		const bytes = new Uint8Array(await new Response(projectCsvStream(fresh())).arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for spreadsheets
		const csv = new TextDecoder().decode(bytes);
		const lines = csv.trim().split('\r\n');
		expect(lines[0]).toBe(
			'Ticket ID,Title,Type,Status,Priority,Reporter,Assignee,Labels,Votes,Release,Milestone,Created,Updated,Completed,URL'
		);
		expect(lines).toHaveLength(122);
		expect(lines[1]).toContain(`"'=cmd|""/c calc""!A1"`);
		expect(() => requireExporter(access(member, fresh()))).toThrow(/owners/);
		expect(() => requireExporter(access(owner, fresh()))).not.toThrow();
	});

	it('exports a user’s own submissions only', () => {
		const other = createTicket(owner, access(owner, fresh()), input('Owner ticket'));
		expect(other).toBeTruthy();
		const mine = personalExport(member);
		expect(mine.tickets).toHaveLength(121);
		expect(mine.tickets.some((t) => t.title === 'Owner ticket')).toBe(false);
		expect(
			personalExport(owner)
				.comments.map((c) => c.body_text)
				.sort()
		).toEqual(['public', 'staff only note']);
		removeMember(owner.id, fresh(), member.id, null);
		expect(personalExport(member).tickets).toEqual([]);
	});
});

describe('queue claims', () => {
	it('claims each due job once', async () => {
		process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS = 'true';
		behaviour = (_req, res) => res.writeHead(204).end();
		createHook(
			owner.id,
			access(owner, fresh()),
			'webhook',
			{ name: 'Bot', url: `http://127.0.0.1:${port}/`, events: ['ticket.created'], enabled: true },
			null
		);
		createTicket(member, access(member, fresh()), input('Once'));
		const a = claimJobs(10);
		const b = claimJobs(10);
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(0); // leased
		expect(a[0].status).toBe('running');
	});
});
