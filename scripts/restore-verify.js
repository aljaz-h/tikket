// Dry-run restore check: everything backup-verify does, plus applying this version's migrations
// to a temporary copy of the database. Never touches DATA_DIR or the backup.
// Usage: node scripts/restore-verify.js <backup.db | backup.tar.gz> [--uploads <dir>] [--json]
import Database from 'better-sqlite3';
import path from 'node:path';
import { printResult, verifyBackup } from './lib/backup-check.js';
import { runMigrations } from './migrations.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const uploadsAt = args.indexOf('--uploads');
const input = args.find((a, i) => !a.startsWith('--') && (uploadsAt < 0 || i !== uploadsAt + 1));
if (!input) {
	console.error(
		'Usage: npm run restore:verify -- <backup.db | backup.tar.gz> [--uploads <dir>] [--json]'
	);
	process.exit(2);
}
const migrationsDir = path.resolve(process.env.MIGRATIONS_DIR || './drizzle');
const result = verifyBackup(path.resolve(input), {
	migrationsDir,
	uploads: uploadsAt >= 0 ? path.resolve(args[uploadsAt + 1]) : undefined,
	migrate: (dbFile) => {
		const sqlite = new Database(dbFile);
		try {
			sqlite.pragma('foreign_keys = ON');
			return runMigrations(sqlite, { migrationsFolder: migrationsDir });
		} finally {
			sqlite.close();
		}
	}
});
if (!process.env.ENCRYPTION_KEY && result.details.encryptedSecrets)
	result.checks.push({
		level: 'warn',
		message:
			'ENCRYPTION_KEY is not set in this environment – set the same key as the original server before restoring'
	});
printResult(result, json);
process.exitCode = result.restorable ? 0 : 1;
