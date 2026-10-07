import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, useDatabase } from '../../src/lib/server/db';

/** Tiny tar writer for fixtures (ustar; `type` lets tests craft hostile entries). */
function tar(entries: { name: string; data?: Buffer; type?: string; link?: string }[]) {
	const blocks: Buffer[] = [];
	for (const e of entries) {
		const data = e.data ?? Buffer.alloc(0);
		const h = Buffer.alloc(512);
		h.write(e.name, 0, 100, 'utf8');
		h.write('0000644\0', 100);
		h.write('0000000\0', 108);
		h.write('0000000\0', 116);
		h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
		h.write('00000000000\0', 136);
		h.write('        ', 148);
		h.write(e.type ?? '0', 156);
		if (e.link) h.write(e.link, 157, 100);
		h.write('ustar\0', 257);
		h.write('00', 263);
		let sum = 0;
		for (const b of h) sum += b;
		h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
		blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return Buffer.concat(blocks);
}

function run(script: string, ...args: string[]) {
	const r = spawnSync(process.execPath, [`scripts/${script}`, ...args, '--json'], {
		encoding: 'utf8',
		env: { ...process.env, ENCRYPTION_KEY: '' }
	});
	return { code: r.status, result: JSON.parse(r.stdout || '{}'), stderr: r.stderr };
}
const messages = (r: { result: { checks: { message: string }[] } }) =>
	r.result.checks.map((c) => c.message).join('\n');

/** A migrated Tikket database with one attachment row, plus its upload file. */
function fixture(migrations = path.resolve('drizzle')) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-bk-'));
	const file = path.join(dir, 'tikket.db');
	closeDatabase();
	const { sqlite } = openDatabase(file, migrations);
	sqlite.exec(`
		insert into users(id,username,email,display_name,password_hash) values (1,'a','a@x','A','h');
		insert into attachments(id,uploader_id,kind,original_name,mime_type,extension,size,attached_at)
			values ('abcdef0123456789abcdef01',1,'ticket','shot.png','image/png','png',4,1);
	`);
	sqlite.pragma('wal_checkpoint(TRUNCATE)');
	sqlite.close();
	useDatabase(null);
	const db = fs.readFileSync(file);
	const meta = {
		format: 'tikket-backup',
		version: 1,
		createdAt: new Date().toISOString(),
		sha256: crypto.createHash('sha256').update(db).digest('hex')
	};
	return {
		dir,
		file,
		db,
		meta,
		upload: { name: 'uploads/ab/abcdef0123456789abcdef01.png', data: Buffer.from('PNG!') }
	};
}

describe('backup verification', () => {
	it('accepts a valid database snapshot with metadata and checks uploads when given', () => {
		const f = fixture();
		const snap = path.join(f.dir, 'tikket-2026.db');
		fs.writeFileSync(snap, f.db);
		fs.writeFileSync(snap.replace('.db', '.json'), JSON.stringify(f.meta));
		const before = fs.readFileSync(snap);
		const r = run('backup-verify.js', snap);
		expect(r.code, messages(r)).toBe(0);
		expect(r.result.restorable).toBe(true);
		expect(messages(r)).toMatch(/checksum matches/);
		expect(messages(r)).toMatch(/upload files not checked/);
		fs.mkdirSync(path.join(f.dir, 'up', 'ab'), { recursive: true });
		const withUploads = run('backup-verify.js', snap, '--uploads', path.join(f.dir, 'up'));
		expect(messages(withUploads)).toMatch(/1 of 1 attachment file\(s\) are missing/);
		expect(fs.readFileSync(snap).equals(before)).toBe(true);
	});

	it('accepts a valid tar.gz archive with uploads', () => {
		const f = fixture();
		const archive = path.join(f.dir, 'backup.tar.gz');
		fs.writeFileSync(
			archive,
			zlib.gzipSync(
				tar([
					{ name: 'backups/', type: '5' },
					{ name: 'backups/tikket-2026-01-01.db', data: f.db },
					{ name: 'backups/tikket-2026-01-01.json', data: Buffer.from(JSON.stringify(f.meta)) },
					f.upload
				])
			)
		);
		const r = run('backup-verify.js', archive);
		expect(r.code, messages(r)).toBe(0);
		expect(messages(r)).toMatch(/All 1 attachment file\(s\) are present/);
	});

	it('reports missing attachment files as a warning', () => {
		const f = fixture();
		const archive = path.join(f.dir, 'b.tar');
		fs.writeFileSync(
			archive,
			tar([
				{ name: 'backups/tikket-1.db', data: f.db },
				{ name: 'uploads/', type: '5' }
			])
		);
		const r = run('backup-verify.js', archive);
		expect(r.result.restorable).toBe(true);
		expect(r.result.checks.find((c: { message: string }) => /missing/.test(c.message)).level).toBe(
			'warn'
		);
	});

	it('rejects invalid archives, corrupt SQLite and foreign databases', () => {
		const f = fixture();
		const garbage = path.join(f.dir, 'g.tar.gz');
		fs.writeFileSync(
			garbage,
			zlib.gzipSync(tar([{ name: 'backups/tikket-1.db', data: f.db }])).subarray(0, 200)
		);
		expect(run('backup-verify.js', garbage).code).toBe(1);
		expect(messages(run('backup-verify.js', garbage))).toMatch(/Corrupt or truncated gzip/);

		const corrupt = Buffer.from(f.db);
		corrupt.fill(0x41, 4096, 4096 * 3);
		const corruptFile = path.join(f.dir, 'corrupt.db');
		fs.writeFileSync(corruptFile, corrupt);
		const c = run('backup-verify.js', corruptFile);
		expect(c.code).toBe(1);
		expect(messages(c)).toMatch(/integrity|Not a valid SQLite/);

		const other = path.join(f.dir, 'other.db');
		new Database(other).exec('create table notes(x)');
		expect(messages(run('backup-verify.js', other))).toMatch(/missing tables/);
	});

	it('rejects backups from a newer schema', () => {
		const f = fixture();
		const db = new Database(f.file);
		db.prepare('insert into __drizzle_migrations(hash, created_at) values (?, ?)').run(
			'future',
			Date.now()
		);
		db.close();
		const r = run('backup-verify.js', f.file);
		expect(r.code).toBe(1);
		expect(messages(r)).toMatch(/newer Tikket/);
	});

	it('rejects path traversal and links in archives', () => {
		const f = fixture();
		for (const entries of [
			[{ name: '../evil.db', data: f.db }],
			[
				{ name: 'backups/tikket-1.db', data: f.db },
				{ name: 'uploads/x', type: '2', link: '/etc/passwd' }
			],
			[{ name: '/abs/tikket.db', data: f.db }]
		]) {
			const file = path.join(f.dir, `${crypto.randomUUID()}.tar`);
			fs.writeFileSync(file, tar(entries));
			const r = run('backup-verify.js', file);
			expect(r.code).toBe(1);
			expect(messages(r)).toMatch(/Path traversal|Links are not allowed|Unsafe path/);
		}
	});

	it('dry-run restore migrates a copy of an older backup and leaves it untouched', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-old-'));
		const migrations = path.join(dir, 'migrations');
		fs.cpSync('drizzle', migrations, { recursive: true });
		const journalFile = path.join(migrations, 'meta/_journal.json');
		const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
		journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < '0006');
		fs.writeFileSync(journalFile, JSON.stringify(journal));
		const f = fixture(migrations);
		const before = fs.readFileSync(f.file);
		const r = run('restore-verify.js', f.file);
		expect(r.code, messages(r)).toBe(0);
		expect(messages(r)).toMatch(/older backup/);
		expect(messages(r)).toMatch(/Dry-run restore: migrations applied to a copy \(2 applied/);
		expect(fs.readFileSync(f.file).equals(before)).toBe(true);
	});

	it('backup.js writes metadata and records the last backup', () => {
		const f = fixture();
		const r = spawnSync(process.execPath, ['scripts/backup.js', path.join(f.dir, 'backups'), '2'], {
			encoding: 'utf8',
			env: { ...process.env, DATA_DIR: f.dir, DATABASE_PATH: '' }
		});
		expect(r.status, r.stderr).toBe(0);
		const last = JSON.parse(
			fs.readFileSync(path.join(f.dir, 'backups', 'last-backup.json'), 'utf8')
		);
		expect(last).toMatchObject({ format: 'tikket-backup', encryptedSecretsPresent: false });
		const snap = path.join(f.dir, 'backups', last.file);
		expect(run('backup-verify.js', snap).result.restorable).toBe(true);
	});
});
