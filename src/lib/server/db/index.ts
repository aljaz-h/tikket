import SQLite from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import * as schema from './schema';
// Shared with the CLI (`scripts/migrate.js`); bundled into the server build.
import { runMigrations } from '../../../../scripts/migrations.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;
/** A database handle or a transaction – both expose the same query API. */
export type DB = BaseSQLiteDatabase<'sync', SQLite.RunResult, typeof schema>;

interface Instance {
	sqlite: SQLite.Database;
	db: AppDatabase;
	path: string;
}

let instance: Instance | null = null;

/** Opens a SQLite database with production pragmas and applies pending migrations. */
export function openDatabase(file: string, migrationsFolder = config.migrationsDir): Instance {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
	const sqlite = new SQLite(file);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('temp_store = MEMORY');
	sqlite.pragma('cache_size = -16000');
	try {
		const { applied, total } = runMigrations(sqlite, { migrationsFolder });
		if (applied) console.info(`[tikket] database migrations applied: ${applied} (now at ${total})`);
	} catch (err) {
		sqlite.close();
		throw new Error(
			`Database migration failed for ${file}: ${err instanceof Error ? err.message : err}. ` +
				'No data was changed by the failed migration (it runs in a transaction). ' +
				'Restore the previous image or a backup and check the release notes.',
			{ cause: err }
		);
	}
	const db = drizzle(sqlite, { schema });
	return { sqlite, db, path: file };
}

export function getInstance(): Instance {
	if (!instance) instance = openDatabase(config.databasePath);
	return instance;
}

export function getDb(): AppDatabase {
	return getInstance().db;
}

/** Swaps the active database (used by tests). */
export function useDatabase(next: Instance | null) {
	instance = next;
}

export function closeDatabase() {
	if (!instance) return;
	try {
		instance.sqlite.pragma('wal_checkpoint(TRUNCATE)');
	} catch {
		/* ignore */
	}
	instance.sqlite.close();
	instance = null;
}

export { schema };
