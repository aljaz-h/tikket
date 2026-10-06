// Shared, dependency-light migration runner used by the server start-up and `scripts/migrate.js`.
//
// Drizzle's SQLite migrator reads the last applied migration *before* opening its transaction, so
// two processes starting at the same time (for example an old and a new container overlapping
// during a redeploy) could both try to apply the same migration. We serialise migrations across
// processes with an exclusive SQLite lock on a small sidecar database. SQLite file locks are
// released by the operating system if a process dies, so a crash can never leave a stale lock.
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

/**
 * Applies pending migrations to `sqlite` while holding a cross-process lock.
 * @param {import('better-sqlite3').Database} sqlite open connection to the application database
 * @param {{ migrationsFolder: string; lockTimeoutMs?: number }} options
 * @returns {{ applied: number; total: number }}
 */
export function runMigrations(sqlite, { migrationsFolder, lockTimeoutMs = 120_000 }) {
	const file = sqlite.name;
	const inMemory = !file || file === ':memory:';
	const lock = inMemory ? null : new Database(`${file}.migrate-lock`);
	try {
		if (lock) {
			lock.pragma(`busy_timeout = ${lockTimeoutMs}`);
			// Blocks (up to lockTimeoutMs) while another process is migrating.
			lock.exec('BEGIN EXCLUSIVE');
		}
		/** @returns {number} */
		const count = () => {
			const exists = /** @type {{ n: number }} */ (
				sqlite
					.prepare(
						"select count(*) as n from sqlite_master where type = 'table' and name = '__drizzle_migrations'"
					)
					.get()
			);
			if (!exists.n) return 0;
			return /** @type {{ n: number }} */ (
				sqlite.prepare('select count(*) as n from __drizzle_migrations').get()
			).n;
		};
		const before = count();
		migrate(drizzle(sqlite), { migrationsFolder });
		const after = count();
		return { applied: after - before, total: after };
	} finally {
		if (lock) {
			try {
				lock.exec('ROLLBACK');
			} catch {
				/* not in a transaction */
			}
			lock.close();
		}
	}
}
