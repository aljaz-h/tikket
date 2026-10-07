// Creates a consistent online backup of the SQLite database (safe while Tikket is running),
// writes a metadata file next to it and records it as the last successful backup, then prunes
// old backups.
// Usage: node scripts/backup.js [targetDir] [keep]
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const file = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'tikket.db'));
const target = path.resolve(process.argv[2] ?? path.join(dataDir, 'backups'));
const keep = Number(process.argv[3] ?? 14);

fs.mkdirSync(target, { recursive: true, mode: 0o750 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(target, `tikket-${stamp}.db`);
const db = new Database(file, { readonly: true, fileMustExist: true });
await db.backup(out);
db.close();

// Metadata: lets `npm run backup:verify` check the snapshot and the admin page show it.
const snapshot = new Database(out, { readonly: true });
const migrations = snapshot.prepare('select count(*) as n from __drizzle_migrations').get().n;
const tables = new Set(
	snapshot
		.prepare("select name from sqlite_master where type = 'table'")
		.all()
		.map((r) => r.name)
);
const count = (sql) => (snapshot.prepare(sql).get()?.n ?? 0) > 0;
const encryptedSecretsPresent =
	(tables.has('project_hooks') && count('select count(*) as n from project_hooks')) ||
	(tables.has('github_connections') && count('select count(*) as n from github_connections')) ||
	(tables.has('app_settings') &&
		count(`select count(*) as n from app_settings where value like '%passwordEnc":"%'`));
snapshot.close();
let version = 'unknown';
try {
	version = JSON.parse(
		fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
	).version;
} catch {
	/* not available */
}
const bytes = fs.statSync(out).size;
const meta = {
	format: 'tikket-backup',
	version: 1,
	appVersion: version,
	createdAt: new Date().toISOString(),
	file: path.basename(out),
	bytes,
	sha256: crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex'),
	migrations,
	encryptedSecretsPresent
};
fs.writeFileSync(out.replace(/\.db$/, '.json'), `${JSON.stringify(meta, null, 2)}\n`);
// The admin Backups page reads this (only when the backup went to the data volume).
fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true, mode: 0o750 });
fs.writeFileSync(
	path.join(dataDir, 'backups', 'last-backup.json'),
	`${JSON.stringify(meta, null, 2)}\n`
);
console.log(`Database backup written to ${out}`);

const backups = fs
	.readdirSync(target)
	.filter((f) => /^tikket-.*\.db$/.test(f))
	.sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
	fs.unlinkSync(path.join(target, old));
	fs.rmSync(path.join(target, old.replace(/\.db$/, '.json')), { force: true });
	console.log(`Removed old backup ${old}`);
}
