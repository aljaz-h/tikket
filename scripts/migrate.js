// Applies pending database migrations. The server also does this automatically on start,
// so running this manually is optional (useful before switching traffic or for diagnostics).
// Usage: node scripts/migrate.js   (honours DATABASE_PATH / DATA_DIR / MIGRATIONS_DIR)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrations.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const file = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'tikket.db'));
fs.mkdirSync(path.dirname(file), { recursive: true });
const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
try {
	const { applied, total } = runMigrations(sqlite, {
		migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR || './drizzle')
	});
	console.log(`Migrations: ${applied} applied, ${total} total – ${file}`);
} catch (err) {
	console.error(`Migration failed for ${file}:`, err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	sqlite.close();
}
