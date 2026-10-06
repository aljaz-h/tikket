import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, useDatabase } from '../../src/lib/server/db';

function runMigrateCli(dataDir: string) {
	return new Promise<{ code: number | null; out: string }>((resolve) => {
		const child = spawn(process.execPath, ['scripts/migrate.js'], {
			env: { ...process.env, DATA_DIR: dataDir, DATABASE_PATH: '' }
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('close', (code) => resolve({ code, out }));
	});
}

describe('database migrations', () => {
	it('are safe when several processes start at the same time', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-mig-'));
		const results = await Promise.all(Array.from({ length: 4 }, () => runMigrateCli(dir)));
		for (const r of results) expect(r.code, r.out).toBe(0);
		// Exactly one process applied the migrations; the others found nothing to do.
		const applied = results.map((r) => Number(/(\d+) applied/.exec(r.out)?.[1]));
		expect(applied.filter((n) => n > 0)).toHaveLength(1);
		const db = new Database(path.join(dir, 'tikket.db'));
		const rows = db.prepare('select count(*) as n from __drizzle_migrations').get() as {
			n: number;
		};
		expect(rows.n).toBe(fs.readdirSync('drizzle').filter((f) => f.endsWith('.sql')).length);
		db.close();
	});

	it('are idempotent and never touch existing data', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-mig-'));
		const file = path.join(dir, 'tikket.db');
		closeDatabase();
		const first = openDatabase(file, path.resolve('drizzle'));
		first.sqlite
			.prepare(
				"insert into users(username,email,display_name,password_hash) values('keep','keep@x','Keep','h')"
			)
			.run();
		first.sqlite.close();
		const second = openDatabase(file, path.resolve('drizzle'));
		const count = second.sqlite.prepare('select count(*) as n from users').get() as { n: number };
		expect(count.n).toBe(1);
		second.sqlite.close();
		useDatabase(null);
	});

	it('report a clear error and leave the database unchanged when a migration fails', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-mig-'));
		const migrations = path.join(dir, 'migrations');
		fs.cpSync('drizzle', migrations, { recursive: true });
		const file = path.join(dir, 'tikket.db');
		openDatabase(file, migrations).sqlite.close();
		// Add a broken migration.
		const journal = JSON.parse(
			fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8')
		);
		const last = journal.entries.at(-1);
		journal.entries.push({
			...last,
			idx: last.idx + 1,
			when: last.when + 1000,
			tag: '9999_broken'
		});
		fs.writeFileSync(path.join(migrations, 'meta/_journal.json'), JSON.stringify(journal));
		fs.writeFileSync(
			path.join(migrations, '9999_broken.sql'),
			'CREATE TABLE ok_part (id integer);\n--> statement-breakpoint\nTHIS IS NOT SQL;'
		);
		expect(() => openDatabase(file, migrations)).toThrow(/Database migration failed/);
		const db = new Database(file);
		expect(
			db.prepare("select count(*) as n from sqlite_master where name = 'ok_part'").get()
		).toEqual({ n: 0 });
		db.close();
	});
});
