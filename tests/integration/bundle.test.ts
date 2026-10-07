import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import { createTicket } from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { originalPath, storeImage } from '../../src/lib/server/uploads';
import { projectBundleStream } from '../../src/lib/server/services/bundle';
import {
	confirmImport,
	createImport,
	getImport,
	importsDir,
	reviewImport
} from '../../src/lib/server/services/import';
import { readZipDirectory, readZipEntry, zipBuffer, ZipWriter } from '../../src/lib/server/zip';

let owner: User, source: Project, target: Project;
const fresh = (p: Project) => findProjectById(p.id)!;
const png = (color: string) =>
	sharp({ create: { width: 40, height: 30, channels: 3, background: color } })
		.png()
		.toBuffer();
const upload = async (name: string, color: string) =>
	storeImage(new File([new Uint8Array(await png(color))], name, { type: 'image/png' }), {
		uploaderId: owner.id
	});
const bundleOf = async (p: Project, scope: 'standard' | 'staff' = 'staff') =>
	Buffer.from(await new Response(projectBundleStream(fresh(p), scope)).arrayBuffer());
const importBundle = (data: Buffer, name = 'bundle.zip') =>
	createImport(owner.id, access(owner, fresh(target)), { name, size: data.length, data });
const review = (id: string) =>
	reviewImport(access(owner, fresh(target)), getImport(access(owner, fresh(target)), id));
/** Rewrites a bundle's entries (tamper helper). */
function rewrite(
	buf: Buffer,
	change: (name: string, data: Buffer) => Buffer | null,
	extra: { name: string; data: Buffer }[] = []
) {
	const entries = readZipDirectory(buf)
		.map((e) => ({ name: e.name, data: change(e.name, readZipEntry(buf, e)) }))
		.filter((e): e is { name: string; data: Buffer } => e.data !== null);
	return zipBuffer([...entries, ...extra]);
}

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	source = makeProject(owner, { key: 'SRC' });
	target = makeProject(owner, { key: 'DST' });
	const member = await makeUser();
	join(owner, source, member);
	const shot = await upload('screen shot.png', '#ff0000');
	const t = createTicket(
		member,
		access(member, fresh(source)),
		{
			type: 'bug',
			title: 'Crash with screenshot',
			descriptionHtml: '<p>see image</p>',
			descriptionText: 'see image',
			context: {}
		},
		[]
	);
	// Attach the screenshot (uploaded by owner) directly, plus one on a comment.
	getDb()
		.update(schema.attachments)
		.set({ ticketId: t.id, projectId: source.id, kind: 'ticket', attachedAt: new Date() })
		.where(eq(schema.attachments.id, shot.id))
		.run();
	const commentImage = await upload('detail.png', '#00ff00');
	addComment(
		owner,
		access(owner, fresh(source)),
		t,
		{ html: '<p>closer look</p>', text: 'closer look' },
		[commentImage.id]
	);
});

describe('project bundles', () => {
	it('exports JSON, attachments and checksums', async () => {
		const zip = await bundleOf(source);
		const names = readZipDirectory(zip)
			.map((e) => e.name)
			.sort();
		expect(names).toEqual(expect.arrayContaining(['manifest.json', 'project.json']));
		expect(names.filter((n) => n.startsWith('attachments/'))).toHaveLength(2);
		const manifest = JSON.parse(
			readZipEntry(
				zip,
				readZipDirectory(zip).find((e) => e.name === 'manifest.json')!
			).toString()
		);
		expect(manifest).toMatchObject({ format: 'tikket-project-bundle', version: 1, project: 'SRC' });
		for (const f of manifest.files) {
			const data = readZipEntry(
				zip,
				readZipDirectory(zip).find((e) => e.name === f.path)!
			);
			expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(f.sha256);
		}
	});

	it('round-trips tickets, comments and their images', async () => {
		const zip = await bundleOf(source);
		const id = importBundle(zip);
		const r = review(id);
		expect(r.attachments).toMatchObject({ count: 2, problems: [] });
		expect(fs.existsSync(`${importsDir()}/${id}.zip`)).toBe(true);
		const { result } = confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(result).toMatchObject({ tickets: 1, attachments: 2 });
		expect(fs.existsSync(`${importsDir()}/${id}.zip`)).toBe(false);
		const t = getDb()
			.select()
			.from(schema.tickets)
			.where(eq(schema.tickets.projectId, target.id))
			.get()!;
		const atts = getDb()
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.ticketId, t.id))
			.all();
		expect(atts.map((a) => a.originalName).sort()).toEqual(['detail.png', 'screen shot.png']);
		const onComment = atts.find((a) => a.commentId)!;
		const comment = getDb()
			.select()
			.from(schema.ticketComments)
			.where(eq(schema.ticketComments.id, onComment.commentId!))
			.get()!;
		expect(comment.ticketId).toBe(t.id);
		expect(comment.bodyText).toBe('closer look');
		// Same bytes as the originals.
		const originals = getDb()
			.select()
			.from(schema.attachments)
			.where(
				and(eq(schema.attachments.projectId, source.id), isNotNull(schema.attachments.ticketId))
			)
			.all();
		const byName = new Map(
			originals.map((o) => [o.originalName, fs.readFileSync(originalPath(o))])
		);
		for (const a of atts)
			expect(fs.readFileSync(originalPath(a)).equals(byName.get(a.originalName)!)).toBe(true);
	});

	it('skips tampered or invalid attachments with a warning and rejects a tampered project.json', async () => {
		const zip = await bundleOf(source);
		const tampered = rewrite(zip, (name, data) =>
			name.startsWith('attachments/') &&
			name.includes(
				readZipDirectory(zip)
					.filter((e) => e.name.startsWith('attachments/'))[0]
					.name.split('/')[1]
			)
				? Buffer.concat([data, Buffer.from('x')])
				: data
		);
		const r = review(importBundle(tampered));
		expect(r.attachments!.count).toBe(1);
		expect(r.attachments!.problems[0].reason).toBe('checksum mismatch');

		const badJson = rewrite(zip, (name, data) =>
			name === 'project.json' ? Buffer.from(data.toString().replace('Crash', 'Hack')) : data
		);
		expect(() => importBundle(badJson)).toThrow(/does not match the bundle checksum/);
	});

	it('reports missing attachments and imports the rest', async () => {
		const zip = await bundleOf(source);
		const first = readZipDirectory(zip).find((e) => e.name.startsWith('attachments/'))!.name;
		const missing = rewrite(zip, (name, data) => (name === first ? null : data));
		const id = importBundle(missing);
		expect(review(id).attachments!.problems).toEqual([
			{ name: expect.any(String), reason: 'file missing from the bundle' }
		]);
		const { result } = confirmImport(owner.id, access(owner, fresh(target)), id, null);
		expect(result.attachments).toBe(1);
	});

	it('rejects non-image content, path traversal, symlinks and unexpected files', async () => {
		const zip = await bundleOf(source);
		let fakePath = '';
		const fake = rewrite(zip, (name, data) => {
			if (name !== 'manifest.json') return data;
			const m = JSON.parse(data.toString());
			const html = Buffer.from('<script>alert(1)</script>');
			m.files[0].size = html.length;
			m.files[0].sha256 = crypto.createHash('sha256').update(html).digest('hex');
			fakePath = m.files[0].path;
			return Buffer.from(JSON.stringify(m));
		});
		const withHtml = rewrite(fake, (name, data) =>
			name === fakePath ? Buffer.from('<script>alert(1)</script>') : data
		);
		expect(review(importBundle(withHtml)).attachments!.problems[0].reason).toBe(
			'not an allowed image'
		);

		expect(() =>
			importBundle(zipBuffer([{ name: '../evil.txt', data: Buffer.from('x') }]))
		).toThrow(/Unsafe path/);
		expect(() =>
			importBundle(
				rewrite(zip, (_n, d) => d, [{ name: 'extra/notes.txt', data: Buffer.from('x') }])
			)
		).toThrow(/Unexpected file/);

		// A symlink entry (Unix mode 120777 in the external attributes).
		const w = new ZipWriter();
		const parts = [w.add('attachments/link', Buffer.from('/etc/passwd')), w.finish()];
		const link = Buffer.concat(parts);
		const cd = link.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		link.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
		expect(() => importBundle(link)).toThrow(/Symbolic links/);
	});

	it('rejects zip bombs and garbage', async () => {
		const bomb = zipBuffer([{ name: 'project.json', data: Buffer.alloc(60 * 1024 * 1024) }]);
		expect(() => importBundle(bomb)).toThrow(/too large|ratio/);
		expect(() => importBundle(Buffer.from('PK\x03\x04garbage'), 'x.zip')).toThrow(
			/Not a ZIP|truncated/
		);
	});

	it('a failed import leaves no attachment files behind', async () => {
		const zip = await bundleOf(source);
		const id = importBundle(zip);
		const before = getDb().select().from(schema.attachments).all().length;
		// Make the transaction fail after the files were written.
		getDb().run(
			`create trigger fail_comment before insert on ticket_comments begin select raise(abort, 'boom'); end` as never
		);
		const files = (dir: string): number =>
			fs
				.readdirSync(dir, { withFileTypes: true })
				.reduce((n, e) => n + (e.isDirectory() ? files(`${dir}/${e.name}`) : 1), 0);
		const uploads = process.env.UPLOADS_DIR!;
		const filesBefore = files(uploads);
		expect(() => confirmImport(owner.id, access(owner, fresh(target)), id, null)).toThrow(
			/nothing was imported/
		);
		expect(getDb().select().from(schema.attachments).all()).toHaveLength(before);
		expect(files(uploads)).toBe(filesBefore);
	});
});
