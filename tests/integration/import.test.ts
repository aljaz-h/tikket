import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import {
	changeStatus,
	createTicket,
	getTicket,
	setTicketLabels
} from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { createLabel } from '../../src/lib/server/services/projects';
import { projectJsonStream } from '../../src/lib/server/services/export';
import {
	confirmImport,
	createImport,
	getImport,
	guessMapping,
	parseCsv,
	reviewImport,
	updateImportOptions
} from '../../src/lib/server/services/import';

let owner: User, mod: User, member: User, source: Project, target: Project;
const fresh = (p: Project) => findProjectById(p.id)!;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: title,
	context: {}
});
async function streamText(stream: ReadableStream<Uint8Array>) {
	return new Response(stream).text();
}
const upload = (name: string, text: string, as: User = owner, p: Project = target) =>
	createImport(as.id, access(as, fresh(p)), { name, text, size: text.length });
const tickets = (p: Project) =>
	getDb().select().from(schema.tickets).where(eq(schema.tickets.projectId, p.id)).all();

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	mod = await makeUser();
	member = await makeUser();
	source = makeProject(owner, { key: 'SRC' });
	target = makeProject(owner, { key: 'DST' });
	join(owner, source, mod, 'moderator');
	join(owner, target, mod, 'moderator');
	join(owner, source, member);
});

describe('CSV parsing', () => {
	it('handles quotes, escaped quotes, newlines, BOM and semicolons', () => {
		expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"multi\nline",z\n')).toEqual([
			['a', 'b'],
			['x, y', 'he said "hi"'],
			['multi\nline', 'z']
		]);
		expect(parseCsv('a;b\n1;2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
		expect(() => parseCsv('a,b\n"open,1')).toThrow(/unterminated/);
	});

	it('guesses the mapping of Tikket CSV exports', () => {
		const m = guessMapping([
			'Ticket ID',
			'Title',
			'Type',
			'Status',
			'Priority',
			'Reporter',
			'Assignee',
			'Labels'
		]);
		expect(m).toMatchObject({
			ref: 0,
			title: 1,
			type: 2,
			status: 3,
			priority: 4,
			reporter: 5,
			assignee: 6,
			labels: 7
		});
		expect(m.description).toBe(-1);
	});
});

describe('imports', () => {
	it('only owners import', () => {
		expect(() => upload('x.csv', 'Title\nHello world', mod)).toThrow(/owners/);
	});

	it('rejects unsupported and malformed files', () => {
		expect(() => upload('x.exe', 'MZ')).toThrow(/JSON export|CSV/);
		expect(() => upload('x.json', '{oops')).toThrow(/not valid JSON/);
		expect(() => upload('x.json', '{"format":"other","tickets":[]}')).toThrow(
			/Tikket project export/
		);
		expect(() => upload('x.csv', 'Title')).toThrow(/header row/);
	});

	it('imports a CSV after review, sanitises content and keeps references', () => {
		const csv = [
			'ID,Title,Description,Type,Status,Priority,Labels',
			'OLD-7,"Login fails","<script>alert(1)</script>Steps: click",Bug,In Progress,High,"auth; ui"',
			'OLD-8,x,too short,feature,open,low,',
			'OLD-9,"=HYPERLINK(""http://evil"")",Formula title,Feature,nonsense,Critical,',
			',,,,,,'
		].join('\n');
		const id = upload('tracker.csv', csv);
		const row = getImport(access(owner, fresh(target)), id);
		expect(row.status).toBe('review');
		expect(tickets(target)).toHaveLength(0); // nothing before confirmation
		const review = reviewImport(access(owner, fresh(target)), row);
		expect(review.total).toBe(3);
		expect(review.valid).toBe(2);
		expect(review.skipped).toEqual([{ row: 3, reason: 'Title is shorter than 3 characters' }]);
		expect(review.newLabels).toEqual(['auth', 'ui']);
		expect(review.warnings.join(' ')).toMatch(/Unknown status/);

		const { result } = confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(result.tickets).toBe(2);
		const [a, b] = tickets(target).sort((x, y) => x.number - y.number);
		expect(a).toMatchObject({
			title: 'Login fails',
			status: 'in_progress',
			priority: 'high',
			source: 'import',
			externalRef: 'OLD-7',
			reporterId: owner.id
		});
		expect(a.descriptionHtml).not.toContain('<script');
		expect(b.title).toBe('=HYPERLINK("http://evil")');
		expect(b.status).toBe('open');
		const labels = getDb()
			.select()
			.from(schema.ticketLabelAssignments)
			.where(eq(schema.ticketLabelAssignments.ticketId, a.id))
			.all();
		expect(labels).toHaveLength(2);
		const audits = getDb()
			.select()
			.from(schema.auditLogs)
			.where(eq(schema.auditLogs.action, 'project.imported'))
			.all();
		expect(audits).toHaveLength(1);
	});

	it('is idempotent: confirming twice imports once', () => {
		const id = upload('t.csv', 'Title\nFirst ticket\nSecond ticket');
		confirmImport(owner.id, access(owner, fresh(target)), id, null);
		const again = confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(again.alreadyDone).toBe(true);
		expect(tickets(target)).toHaveLength(2);
		expect(getImport(access(owner, fresh(target)), id).payload).toBeNull();
	});

	it('applies the column mapping from the review step', () => {
		const id = upload('t.csv', 'Name,Body\nCustom mapped,Some text');
		expect(
			reviewImport(access(owner, fresh(target)), getImport(access(owner, fresh(target)), id)).valid
		).toBe(1);
		updateImportOptions(access(owner, fresh(target)), id, {
			mapping: { ...guessMapping(['Name', 'Body']), title: 1, description: 0 }
		});
		confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(tickets(target)[0]).toMatchObject({
			title: 'Some text',
			descriptionText: 'Custom mapped'
		});
	});

	it('round-trips a Tikket JSON export with comments, labels, numbers and user mapping', async () => {
		const ui = createLabel(source.id, 'ui', 'sky');
		const t1 = createTicket(member, access(member, fresh(source)), input('Exported one'));
		const t2 = createTicket(member, access(member, fresh(source)), input('Exported two'));
		setTicketLabels(mod, access(mod, fresh(source)), t1, [ui.id]);
		addComment(member, access(member, fresh(source)), t1, {
			html: '<p>Public</p>',
			text: 'Public'
		});
		addComment(
			mod,
			access(mod, fresh(source)),
			t1,
			{ html: '<p>Staff only</p>', text: 'Staff only' },
			[],
			{ internal: true }
		);
		changeStatus(mod, access(mod, fresh(source)), t2, {
			status: 'duplicate',
			note: null,
			duplicateOf: 'SRC-1'
		});
		const json = await streamText(projectJsonStream(fresh(source), 'staff'));

		// The target already has ticket #1, so SRC-1 cannot keep its number.
		createTicket(owner, access(owner, fresh(target)), input('Existing target ticket'));
		const id = upload('export.json', json);
		updateImportOptions(access(owner, fresh(target)), id, { keepNumbers: true, mapUsers: true });
		const review = reviewImport(
			access(owner, fresh(target)),
			getImport(access(owner, fresh(target)), id)
		);
		expect(review.valid).toBe(2);
		expect(review.keptNumbers).toBe(1);
		// member is not a member of the target project: not matched.
		expect(review.unmatchedUsers).toContain(member.username);
		const { result } = confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(result).toMatchObject({ tickets: 2, comments: 2, labelsCreated: 1, keptNumbers: 1 });

		const imported = tickets(target).filter((t) => t.source === 'import');
		const one = imported.find((t) => t.externalRef === 'SRC-1')!;
		const two = imported.find((t) => t.externalRef === 'SRC-2')!;
		expect(one.number).not.toBe(1); // conflicting number → new number
		expect(two.number).toBe(2); // free → kept
		expect(one.reporterId).toBe(owner.id); // unmatched reporter → importer
		expect(two).toMatchObject({ status: 'duplicate', duplicateOfId: one.id });
		const comments = getDb()
			.select()
			.from(schema.ticketComments)
			.where(eq(schema.ticketComments.ticketId, one.id))
			.all();
		expect(comments.map((c) => [c.bodyText, c.internal, c.authorId])).toEqual([
			['Public', false, owner.id],
			['Staff only', true, mod.id] // mod is a member of the target: matched
		]);
		expect(comments[0].meta).toMatchObject({ imported: { author: `User ${member.username}` } });
		expect(one.commentCount).toBe(1);
		// New tickets after the import never collide with kept numbers.
		const next = createTicket(owner, access(owner, fresh(target)), input('After import'));
		expect(imported.map((t) => t.number)).not.toContain(next.number);
		// No accounts were created.
		expect(getDb().select().from(schema.users).all()).toHaveLength(3);
	});

	it('rolls back everything when the import fails', () => {
		const id = upload('t.csv', 'Title\nGood ticket\nAnother good ticket');
		// A database trigger that rejects the second ticket: a failure halfway through.
		const db = getDb();
		db.run(
			`create trigger fail_import before insert on tickets when new.title = 'Another good ticket' begin select raise(abort, 'boom'); end` as never
		);
		expect(() => confirmImport(owner.id, access(owner, fresh(target)), id, null)).toThrow(
			/nothing was imported/
		);
		expect(tickets(target)).toHaveLength(0);
		expect(getImport(access(owner, fresh(target)), id).status).toBe('failed');
		expect(getTicket(target.id, 1)).toBeUndefined();
		expect(
			db
				.select()
				.from(schema.imports)
				.where(and(eq(schema.imports.id, id), eq(schema.imports.status, 'failed')))
				.all()
		).toHaveLength(1);
	});

	it('v0.7 CSV: updated date, row issues, duplicates and mapping warnings', () => {
		createTicket(owner, access(owner, fresh(target)), input('Login fails'));
		const csv = [
			'Key,Summary,Issue Type,Created,Last Modified,Notes',
			'A-1,Login fails,Bug,2025-01-02T10:00:00Z,2025-03-04T10:00:00Z,',
			'A-2,Dark mode,Feature,2025-01-05,not a date,',
			'A-3,dark   MODE,Story,2025-01-06,2024-01-01,'
		].join('\n');
		const id = upload('jira.csv', csv);
		const row = getImport(access(owner, fresh(target)), id);
		const r = reviewImport(access(owner, fresh(target)), row);
		expect((row.options as { mapping: Record<string, number> }).mapping).toMatchObject({
			ref: 0,
			title: 1,
			type: 2,
			created: 3,
			updated: 4
		});
		expect(r.rowIssues).toEqual(
			expect.arrayContaining([
				{ row: 3, message: 'Invalid updated date “not a date”' },
				{ row: 4, message: 'Unknown type “Story” – imported as Bug' }
			])
		);
		expect(r.duplicates).toEqual([
			{ row: 2, title: 'Login fails', existing: 1, sameAsRow: null },
			{ row: 4, title: 'dark MODE', existing: null, sameAsRow: 3 }
		]);
		updateImportOptions(access(owner, fresh(target)), id, {
			mapping: {
				...guessMapping(['Key', 'Summary', 'Issue Type', 'Created', 'Last Modified', 'Notes']),
				description: 5,
				type: 1
			}
		});
		const again = reviewImport(
			access(owner, fresh(target)),
			getImport(access(owner, fresh(target)), id)
		);
		expect(again.mappingWarnings).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/“Summary” is used for Title and Type/),
				'“Notes” is empty in every row.'
			])
		);
		updateImportOptions(access(owner, fresh(target)), id, {
			mapping: guessMapping(['Key', 'Summary', 'Issue Type', 'Created', 'Last Modified', 'Notes'])
		});
		confirmImport(owner.id, access(owner, fresh(target)), id, null);
		const imported = tickets(target)
			.filter((t) => t.source === 'import')
			.sort((a, b) => a.number - b.number);
		expect(imported[0].updatedAt.toISOString()).toBe('2025-03-04T10:00:00.000Z');
		// An update before creation is clamped to the creation date.
		expect(imported[2].updatedAt.getTime()).toBe(imported[2].createdAt.getTime());
	});

	it('guesses common header variants', () => {
		expect(
			guessMapping([
				'Issue key',
				'Summary',
				'Assignee Email',
				'Reporter Email',
				'Tags',
				'Fix Version',
				'Date Created',
				'Updated At'
			])
		).toMatchObject({
			ref: 0,
			title: 1,
			assignee: 2,
			reporter: 3,
			labels: 4,
			release: 5,
			created: 6,
			updated: 7
		});
	});
});
