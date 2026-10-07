// Read-only database check: integrity, foreign keys and schema version.
// Usage: node scripts/db-check.js   (honours DATABASE_PATH / DATA_DIR / MIGRATIONS_DIR)
// Runs PRAGMA integrity_check, which reads the whole database – run it manually, not per request.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const file = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'tikket.db'));
const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR || './drizzle');
let failed = false;
const line = (ok, msg) => {
	if (ok === false) failed = true;
	console.log(`  ${ok === true ? '✓' : ok === false ? '✗' : '⚠'} ${msg}`);
};

if (!fs.existsSync(file)) {
	console.error(`No database at ${file}`);
	process.exit(1);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
try {
	console.log('Tikket database check');
	const integrity = db.pragma('integrity_check', { simple: true });
	line(integrity === 'ok', `Integrity check: ${integrity}`);
	const fk = db.pragma('foreign_key_check');
	line(
		fk.length === 0 ? true : null,
		`Foreign key check: ${fk.length ? `${fk.length} problem(s)` : 'ok'}`
	);
	line(true, `Journal mode: ${db.pragma('journal_mode', { simple: true })}`);
	const applied = db.prepare('select count(*) as n from __drizzle_migrations').get().n;
	const expected = JSON.parse(
		fs.readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8')
	).entries.length;
	line(
		applied === expected ? true : applied < expected ? null : false,
		`Schema: ${applied} of ${expected} migrations${applied < expected ? ' (pending – applied on next start)' : applied > expected ? ' (database is newer than this Tikket)' : ''}`
	);
} catch (err) {
	line(false, `Check failed: ${err.message}`);
} finally {
	db.close();
}
process.exitCode = failed ? 1 : 0;
