// Applies pending database migrations. The server also does this automatically on start.
// Usage: node scripts/migrate.js   (honours DATABASE_PATH / DATA_DIR / MIGRATIONS_DIR)
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const file = path.resolve(process.env.DATABASE_PATH ?? path.join(dataDir, 'tikket.db'));
fs.mkdirSync(path.dirname(file), { recursive: true });
const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
migrate(drizzle(sqlite), {
	migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR ?? './drizzle')
});
sqlite.close();
console.log(`Migrations applied to ${file}`);
