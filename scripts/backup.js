// Creates a consistent online backup of the SQLite database (safe while Tikket is running)
// and optionally prunes old backups.
// Usage: node scripts/backup.js [targetDir] [keep]
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const file = path.resolve(process.env.DATABASE_PATH ?? path.join(dataDir, 'tikket.db'));
const target = path.resolve(process.argv[2] ?? path.join(dataDir, 'backups'));
const keep = Number(process.argv[3] ?? 14);

fs.mkdirSync(target, { recursive: true, mode: 0o750 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(target, `tikket-${stamp}.db`);
const db = new Database(file, { readonly: true, fileMustExist: true });
await db.backup(out);
db.close();
console.log(`Database backup written to ${out}`);

const backups = fs
	.readdirSync(target)
	.filter((f) => /^tikket-.*\.db$/.test(f))
	.sort();
for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
	fs.unlinkSync(path.join(target, old));
	console.log(`Removed old backup ${old}`);
}
