import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { access, actor, freshDb, join, makeProject, makeUser } from '../helpers';
import {
	changeStatus,
	createTicket,
	getTicket,
	getTicketDetail,
	setFollow,
	setVote
} from '../../src/lib/server/services/tickets';
import { addComment, deleteComment, editComment } from '../../src/lib/server/services/comments';
import { listNotifications } from '../../src/lib/server/services/notifications';
import { createLabel, setArchived } from '../../src/lib/server/services/projects';
import {
	createWidgetToken,
	findWidget,
	isOriginAllowed,
	parseOriginList,
	saveWidgetSettings,
	validateWidgetToken,
	type WidgetSettingsInput
} from '../../src/lib/server/services/widget';
import {
	deleteTemplate,
	getTemplateResponse,
	resolveTemplate,
	saveTemplate
} from '../../src/lib/server/services/templates';
import { bulkUpdate } from '../../src/lib/server/services/bulk';
import {
	addRelationship,
	listRelationships,
	removeRelationship
} from '../../src/lib/server/services/relationships';
import { storeImage } from '../../src/lib/server/uploads';
import { canViewInternalNotes, findProjectById } from '../../src/lib/server/authz';
import { globalSearch } from '../../src/lib/server/services/search';
import { closeDatabase, getDb, openDatabase, schema, useDatabase } from '../../src/lib/server/db';
import { validateTemplateAnswers } from '../../src/lib/shared/templates';
import { GET as getFile } from '../../src/routes/api/files/[id]/+server';
import type { Project, User } from '../../src/lib/server/db/schema';

let owner: User, mod: User, member: User, outsider: User, project: Project;
const fresh = () => findProjectById(project.id)!;

const input = (title = 'Checkout button does nothing') => ({
	type: 'bug' as const,
	title,
	descriptionHtml: '<p>Nothing happens</p>',
	descriptionText: 'Nothing happens',
	context: {}
});

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

const widget = (over: Partial<WidgetSettingsInput> = {}): WidgetSettingsInput => ({
	enabled: true,
	buttonLabel: 'Feedback',
	position: 'bottom-right',
	accentColor: '#B8F779',
	defaultType: 'bug',
	screenshotsEnabled: true,
	collectContext: true,
	origins: ['https://shop.example'],
	...over
});

describe('feedback widget', () => {
	it('is unavailable until enabled with at least one origin', () => {
		expect(findWidget('SPL')).toBeNull();
		expect(() => saveWidgetSettings(owner.id, project, widget({ origins: [] }), null)).toThrow(
			/at least one/
		);
		saveWidgetSettings(owner.id, project, widget(), null);
		expect(findWidget('SPL')?.config.accentColor).toBe('#b8f779');
		expect(isOriginAllowed(project.id, 'https://shop.example')).toBe(true);
		// Exact match only: no prefixes, sub-domains, paths or other schemes.
		for (const o of [
			'https://shop.example.evil.com',
			'https://evil.shop.example',
			'http://shop.example',
			'https://shop.example/',
			null
		])
			expect(isOriginAllowed(project.id, o), String(o)).toBe(false);
		expect(findWidget('NOPE')).toBeNull();
	});

	it('parses origin lists and reports invalid lines', () => {
		expect(parseOriginList('https://a.example\nb.example, ftp://c.example\n\n')).toEqual({
			origins: ['https://a.example', 'https://b.example'],
			invalid: ['ftp://c.example']
		});
	});

	it('issues project- and origin-scoped tokens and re-checks access on every use', () => {
		saveWidgetSettings(owner.id, project, widget(), null);
		expect(() => createWidgetToken(actor(outsider), fresh(), 'https://shop.example')).toThrow();
		expect(() => createWidgetToken(actor(member), fresh(), 'https://evil.example')).toThrow();
		const { token } = createWidgetToken(actor(member), fresh(), 'https://shop.example');
		const auth = validateWidgetToken(token, fresh());
		expect(auth?.user.id).toBe(member.id);
		expect(auth?.origin).toBe('https://shop.example');
		// Tokens are stored hashed.
		expect(getDb().select().from(schema.widgetTokens).get()?.id).not.toBe(token);
		// Wrong project or garbage → rejected.
		const other = makeProject(owner, { key: 'OTH' });
		expect(validateWidgetToken(token, other)).toBeNull();
		expect(validateWidgetToken('x'.repeat(40), fresh())).toBeNull();
		// Removing the origin revokes its tokens.
		saveWidgetSettings(owner.id, project, widget({ origins: ['https://other.example'] }), null);
		expect(validateWidgetToken(token, fresh())).toBeNull();
	});

	it('stops accepting tokens when the widget is disabled', () => {
		saveWidgetSettings(owner.id, project, widget(), null);
		const { token } = createWidgetToken(actor(member), fresh(), 'https://shop.example');
		saveWidgetSettings(owner.id, project, widget({ enabled: false }), null);
		expect(findWidget('SPL')).toBeNull();
		expect(validateWidgetToken(token, fresh())).toBeNull();
	});

	it('stores widget tickets with source and sanitised environment', () => {
		const t = createTicket(member, access(member, fresh()), input(), [], {
			source: 'widget',
			environment: { pageUrl: 'https://shop.example/cart', origin: 'https://shop.example' }
		});
		const row = getTicket(project.id, t.number)!;
		expect(row.source).toBe('widget');
		expect(row.environment?.pageUrl).toBe('https://shop.example/cart');
	});
});

describe('ticket templates', () => {
	const base = {
		type: 'bug' as const,
		name: 'Bug report',
		description: null,
		enabled: true,
		isDefault: true,
		fields: [
			{
				kind: 'select' as const,
				label: 'Device',
				help: null,
				placeholder: null,
				required: true,
				options: ['Phone', 'Desktop']
			},
			{
				kind: 'checkbox' as const,
				label: 'Reproducible',
				help: null,
				placeholder: null,
				required: false,
				options: []
			}
		]
	};

	it('versions edits while tickets keep the questions they answered', () => {
		const id = saveTemplate(fresh(), base);
		const tpl = resolveTemplate(project.id, 'bug', null)!;
		expect(tpl.version).toBe(1);
		const answers = validateTemplateAnswers(tpl.fields, {
			tpl_device: 'Phone',
			tpl_reproducible: 'on'
		});
		if (!answers.ok) throw new Error('invalid');
		const t = createTicket(member, access(member, fresh()), input(), [], {
			template: {
				templateId: id,
				templateName: tpl.name,
				templateVersion: tpl.version,
				answers: answers.answers
			}
		});

		saveTemplate(fresh(), {
			...base,
			id,
			name: 'Bug report v2',
			fields: [{ ...base.fields[0], label: 'Which device?' }]
		});
		expect(resolveTemplate(project.id, 'bug', null)?.version).toBe(2);
		deleteTemplate(project.id, id);
		expect(resolveTemplate(project.id, 'bug', null)).toBeNull();

		const snapshot = getTemplateResponse(t.id)!;
		expect(snapshot.templateName).toBe('Bug report');
		expect(snapshot.templateVersion).toBe(1);
		expect(snapshot.answers).toEqual([
			{ key: 'device', label: 'Device', kind: 'select', value: 'Phone' },
			{ key: 'reproducible', label: 'Reproducible', kind: 'checkbox', value: true }
		]);
	});

	it('keeps a single default per type and ignores disabled or foreign templates', () => {
		const a = saveTemplate(fresh(), base);
		const b = saveTemplate(fresh(), { ...base, name: 'Second' });
		expect(resolveTemplate(project.id, 'bug', null)?.id).toBe(b);
		expect(resolveTemplate(project.id, 'bug', a)?.id).toBe(a);
		const other = makeProject(owner, { key: 'OTH' });
		const foreign = saveTemplate(other, base);
		expect(resolveTemplate(project.id, 'bug', foreign)?.id).toBe(b);
		saveTemplate(fresh(), { ...base, id: a, enabled: false, isDefault: false });
		expect(resolveTemplate(project.id, 'bug', a)?.id).toBe(b);
		expect(resolveTemplate(project.id, 'feature', null)).toBeNull();
	});
});

describe('internal staff notes', () => {
	async function png() {
		const buf = await sharp({
			create: { width: 20, height: 20, channels: 3, background: '#ff0000' }
		})
			.png()
			.toBuffer();
		return new File([new Uint8Array(buf)], 'secret.png', { type: 'image/png' });
	}

	it('only staff may write them and only staff can see them, their files or activity', async () => {
		const t = createTicket(member, access(member, fresh()), input());
		const ticket = getTicket(project.id, t.number)!;
		expect(() =>
			addComment(member, access(member, fresh()), ticket, { html: '<p>x</p>', text: 'x' }, [], {
				internal: true
			})
		).toThrow(/staff/);
		const att = await storeImage(await png(), { uploaderId: mod.id });
		const note = addComment(
			mod,
			access(mod, fresh()),
			ticket,
			{
				html: '<p>Customer is on legacy plan @' + owner.username + '</p>',
				text: 'Customer is on legacy plan @' + owner.username
			},
			[att.id],
			{ internal: true }
		);
		addComment(member, access(member, fresh()), ticket, {
			html: '<p>Any update?</p>',
			text: 'Any update?'
		});

		const asMember = getTicketDetail(member, getTicket(project.id, t.number)!, {
			internal: canViewInternalNotes(access(member, fresh()))
		});
		expect(asMember.comments.map((c) => c.bodyHtml)).toEqual(['<p>Any update?</p>']);
		expect(JSON.stringify(asMember)).not.toContain('legacy plan');
		const asOwner = getTicketDetail(owner, getTicket(project.id, t.number)!, {
			internal: canViewInternalNotes(access(owner, fresh()))
		});
		expect(asOwner.comments.filter((c) => c.internal)).toHaveLength(1);

		// Public counters are untouched by the note.
		expect(getTicket(project.id, t.number)!.commentCount).toBe(1);

		// The attachment is staff-only.
		const fetchAs = async (u: User) => {
			try {
				const res = await getFile({
					params: { id: att.id },
					locals: { user: u },
					url: new URL('http://x/'),
					request: new Request('http://x/')
				} as never);
				return res.status;
			} catch (e) {
				return (e as { status: number }).status;
			}
		};
		expect(await fetchAs(member)).toBe(404);
		expect(await fetchAs(owner)).toBe(200);

		// Notifications: the reporter (a member) gets nothing; staff get no content.
		expect(listNotifications(member.id).filter((n) => n.data.internal)).toHaveLength(0);
		const ownerNotes = listNotifications(owner.id).filter((n) => n.data.internal);
		expect(ownerNotes).toHaveLength(1);
		expect(JSON.stringify(ownerNotes)).not.toContain('legacy plan');

		// Not searchable by anyone (comments are not indexed).
		expect(JSON.stringify(globalSearch(member, 'legacy'))).not.toContain('legacy');

		// Members cannot edit or delete it; removal activity stays internal.
		expect(() =>
			editComment(member, access(member, fresh()), note, { html: 'x', text: 'x' })
		).toThrow();
		expect(() => deleteComment(member, access(member, fresh()), note)).toThrow();
		deleteComment(owner, access(owner, fresh()), note);
		const after = getTicketDetail(member, getTicket(project.id, t.number)!, { internal: false });
		expect(after.activity.filter((a) => a.type === 'comment_removed')).toHaveLength(0);
	});

	it('cannot be written in archived projects', () => {
		const t = createTicket(member, access(member, fresh()), input());
		setArchived(owner.id, fresh(), true, null);
		expect(() =>
			addComment(
				owner,
				access(owner, fresh()),
				getTicket(project.id, t.number)!,
				{ html: '<p>x</p>', text: 'x' },
				[],
				{ internal: true }
			)
		).toThrow();
	});
});

describe('bulk editing', () => {
	it('updates many tickets in one transaction, skipping those that already match', () => {
		const a = createTicket(member, access(member, fresh()), input('A'));
		const b = createTicket(member, access(member, fresh()), input('B'));
		const c = createTicket(member, access(member, fresh()), input('C'));
		const other = makeProject(owner, { key: 'OTH' });
		createTicket(owner, access(owner, other), input('Foreign'));
		changeStatus(owner, access(owner, fresh()), getTicket(project.id, c.number)!, {
			status: 'completed',
			note: null
		});

		const r = bulkUpdate(owner, access(owner, fresh()), [a.number, b.number, c.number, 99], {
			kind: 'status',
			status: 'completed'
		});
		expect(r.updated).toEqual([a.number, b.number]);
		expect(r.skipped).toEqual([
			{ number: c.number, reason: 'already has this status' },
			{ number: 99, reason: 'not found in this project' }
		]);
		expect(getTicket(project.id, a.number)!.status).toBe('completed');
		expect(getTicket(other.id, 1)!.status).toBe('open');
		const activity = getTicketDetail(owner, getTicket(project.id, a.number)!, {
			internal: true
		}).activity;
		expect(activity.at(-1)?.data).toMatchObject({ to: 'completed', bulk: true });
		// The reporter gets one notification for the whole operation, not one per ticket.
		const notes = listNotifications(member.id).filter((n) => n.type === 'status');
		expect(notes).toHaveLength(2); // one from the single change of C, one grouped
		expect(notes.some((n) => n.data.bulkCount === 2)).toBe(true);
	});

	it('handles labels and assignment and enforces staff-only access', () => {
		const a = createTicket(member, access(member, fresh()), input('A'));
		const b = createTicket(member, access(member, fresh()), input('B'));
		const label = createLabel(project.id, 'ui', 'blue');
		expect(() =>
			bulkUpdate(member, access(member, fresh()), [a.number], {
				kind: 'priority',
				priority: 'high'
			})
		).toThrow(/staff/);
		const other = makeProject(owner, { key: 'OTH' });
		const foreignLabel = createLabel(other.id, 'x', 'red');
		expect(() =>
			bulkUpdate(owner, access(owner, fresh()), [a.number], {
				kind: 'addLabel',
				labelId: foreignLabel.id
			})
		).toThrow();
		expect(() =>
			bulkUpdate(owner, access(owner, fresh()), [a.number], {
				kind: 'assign',
				assigneeId: outsider.id
			})
		).toThrow();

		expect(
			bulkUpdate(owner, access(owner, fresh()), [a.number, b.number], {
				kind: 'addLabel',
				labelId: label.id
			}).updated
		).toHaveLength(2);
		expect(
			bulkUpdate(owner, access(owner, fresh()), [a.number], {
				kind: 'removeLabel',
				labelId: label.id
			}).updated
		).toEqual([a.number]);
		const assigned = bulkUpdate(owner, access(owner, fresh()), [a.number, b.number], {
			kind: 'assign',
			assigneeId: mod.id
		});
		expect(assigned.updated).toHaveLength(2);
		expect(listNotifications(mod.id).filter((n) => n.type === 'assigned')).toHaveLength(1);
	});
});

describe('duplicate merging', () => {
	it('moves voters and followers to the canonical ticket once and flattens chains', () => {
		const voterA = member;
		const canonical = createTicket(owner, access(owner, fresh()), input('Original'));
		const dup = createTicket(member, access(member, fresh()), input('Copy'));
		const dupOfDup = createTicket(member, access(member, fresh()), input('Copy of copy'));
		setVote(voterA, access(voterA, fresh()), getTicket(project.id, dup.number)!, true);
		setVote(voterA, access(voterA, fresh()), getTicket(project.id, canonical.number)!, true);
		setVote(mod, access(mod, fresh()), getTicket(project.id, dup.number)!, true);
		setFollow(outsider, getTicket(project.id, dup.number)!, true);

		changeStatus(owner, access(owner, fresh()), getTicket(project.id, dupOfDup.number)!, {
			status: 'duplicate',
			note: null,
			duplicateOf: `SPL-${dup.number}`
		});
		changeStatus(owner, access(owner, fresh()), getTicket(project.id, dup.number)!, {
			status: 'duplicate',
			note: null,
			duplicateOf: `SPL-${canonical.number}`
		});

		const c = getTicket(project.id, canonical.number)!;
		expect(c.voteCount).toBe(2); // member counted once, plus mod
		expect(getTicket(project.id, dupOfDup.number)!.duplicateOfId).toBe(c.id);
		const detail = getTicketDetail(owner, c, { internal: true });
		expect(detail.duplicates.map((d) => d.number).sort()).toEqual([dup.number, dupOfDup.number]);
		const followers = getDb()
			.select()
			.from(schema.ticketFollowers)
			.where(eq(schema.ticketFollowers.ticketId, c.id))
			.all()
			.map((f) => f.userId);
		expect(followers).toContain(outsider.id);
		// The duplicate keeps its own votes and history.
		expect(getTicket(project.id, dup.number)!.voteCount).toBe(2);
		// A ticket cannot be merged into one of its duplicates.
		expect(() =>
			changeStatus(owner, access(owner, fresh()), c, {
				status: 'duplicate',
				note: null,
				duplicateOf: `SPL-${dup.number}`
			})
		).toThrow();
	});
});

describe('ticket relationships', () => {
	it('links tickets both ways, prevents duplicates, self links and blocking cycles', () => {
		const a = getTicket(
			project.id,
			createTicket(member, access(member, fresh()), input('A')).number
		)!;
		const b = getTicket(
			project.id,
			createTicket(member, access(member, fresh()), input('B')).number
		)!;
		const c = getTicket(
			project.id,
			createTicket(member, access(member, fresh()), input('C')).number
		)!;
		const own = access(owner, fresh());
		expect(() => addRelationship(member, access(member, fresh()), a, 'relates', 'SPL-2')).toThrow(
			/staff/
		);
		expect(() => addRelationship(owner, own, a, 'relates', `SPL-${a.number}`)).toThrow(/itself/);

		addRelationship(owner, own, a, 'blocks', `SPL-${b.number}`);
		addRelationship(owner, own, b, 'blocks', `SPL-${c.number}`);
		expect(() => addRelationship(owner, own, c, 'blocks', `SPL-${a.number}`)).toThrow(/cycle/);
		expect(() => addRelationship(owner, own, a, 'blocked_by', `SPL-${c.number}`)).toThrow(/cycle/);
		expect(() => addRelationship(owner, own, b, 'relates', `SPL-${a.number}`)).toThrow(
			/already linked/
		);
		addRelationship(owner, own, a, 'relates', `SPL-${c.number}`);

		expect(listRelationships(b.id).map((r) => [r.relation, r.ticket.number])).toEqual([
			['blocked_by', a.number],
			['blocks', c.number]
		]);
		// Other projects cannot be referenced.
		const other = makeProject(owner, { key: 'OTH' });
		createTicket(owner, access(owner, other), input('X'));
		expect(() => addRelationship(owner, own, a, 'relates', 'OTH-1')).toThrow(/No ticket/);

		const rel = listRelationships(a.id).find((r) => r.relation === 'blocks')!;
		removeRelationship(owner, own, a, rel.id);
		expect(listRelationships(b.id).map((r) => r.relation)).toEqual(['blocks']);
		const history = getTicketDetail(owner, b, { internal: true }).activity.map((x) => x.type);
		expect(history).toEqual(expect.arrayContaining(['relation_added', 'relation_removed']));
	});
});

describe('upgrading an existing database', () => {
	it('applies the phase 2 migration without touching existing data', () => {
		closeDatabase();
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-upgrade-'));
		const old = path.join(dir, 'migrations');
		fs.cpSync('drizzle', old, { recursive: true });
		fs.rmSync(path.join(old, '0002_phase2.sql'));
		const journal = JSON.parse(fs.readFileSync(path.join(old, 'meta/_journal.json'), 'utf8'));
		journal.entries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith('0002'));
		fs.writeFileSync(path.join(old, 'meta/_journal.json'), JSON.stringify(journal));

		const file = path.join(dir, 'tikket.db');
		const before = openDatabase(file, old);
		before.sqlite.exec(`
			insert into users(id, username, email, display_name, password_hash) values (1, 'keep', 'keep@x', 'Keep', 'h');
			insert into projects(id, key, name, ticket_counter) values (1, 'OLD', 'Old', 1);
			insert into tickets(id, project_id, number, type, title, description_html, description_text, reporter_id)
				values (1, 1, 1, 'bug', 'Legacy ticket', '<p>x</p>', 'x', 1);
			insert into ticket_comments(ticket_id, author_id, body_html, body_text) values (1, 1, '<p>hi</p>', 'hi');
		`);
		before.sqlite.close();

		const after = openDatabase(file, path.resolve('drizzle'));
		const ticket = after.sqlite
			.prepare('select title, source, environment from tickets')
			.get() as Record<string, unknown>;
		expect(ticket).toEqual({ title: 'Legacy ticket', source: 'web', environment: null });
		const comment = after.sqlite.prepare('select body_text, internal from ticket_comments').get();
		expect(comment).toEqual({ body_text: 'hi', internal: 0 });
		for (const table of ['widget_settings', 'ticket_templates', 'ticket_relationships'])
			expect(after.sqlite.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
		after.sqlite.close();
		useDatabase(null);
	});
});
