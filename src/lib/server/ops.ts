import fs from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { config } from './config';
import { getDb, getInstance, schema } from './db';
import { effectiveSmtp, emailEnabled } from './email/config';
import { queueOverview } from './outbound/admin';
import { encryptionAvailable } from './secrets';

/**
 * Lightweight operational checks for Administration → Health and → Backups. Everything here is
 * cheap (stat calls, PRAGMA reads, counts) except directory sizes, which are walked with a limit
 * and cached for a minute. Nothing is reported off-site; paths are never shown to users.
 */

export const APP_VERSION = process.env.npm_package_version || readVersion();
function readVersion() {
	try {
		return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version as string;
	} catch {
		return 'unknown';
	}
}

const startedAt = new Date();

const sizeCache = new Map<string, { at: number; bytes: number; files: number; partial: boolean }>();
/** Size of a directory tree (bounded walk: at most `maxFiles` entries; cached for 60 s). */
export function dirSize(dir: string, maxFiles = 200_000) {
	const hit = sizeCache.get(dir);
	if (hit && Date.now() - hit.at < 60_000) return hit;
	let bytes = 0;
	let files = 0;
	let partial = false;
	const stack = [dir];
	while (stack.length) {
		const current = stack.pop()!;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (files >= maxFiles) {
				partial = true;
				break;
			}
			const p = path.join(current, e.name);
			if (e.isDirectory()) stack.push(p);
			else if (e.isFile()) {
				try {
					bytes += fs.statSync(p).size;
					files++;
				} catch {
					/* removed meanwhile */
				}
			}
		}
	}
	const result = { at: Date.now(), bytes, files, partial };
	sizeCache.set(dir, result);
	return result;
}

const fileSize = (p: string) => {
	try {
		return fs.statSync(p).size;
	} catch {
		return 0;
	}
};

export function writable(dir: string) {
	try {
		fs.accessSync(dir, fs.constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/** Free space of the data volume, when the platform reports it. */
export function diskSpace(dir: string) {
	try {
		const s = fs.statfsSync(dir);
		return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
	} catch {
		return null;
	}
}

export function databaseStatus() {
	try {
		const { sqlite } = getInstance();
		sqlite.prepare('select 1').get();
		const journal = String(sqlite.pragma('journal_mode', { simple: true }));
		const foreignKeys = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
		const applied = sqlite
			.prepare('select count(*) as n, max(created_at) as last from __drizzle_migrations')
			.get() as { n: number; last: number | null };
		const expected = migrationJournal();
		const file = config.databasePath;
		return {
			connected: true,
			bytes: fileSize(file) + fileSize(`${file}-wal`),
			wal: journal.toLowerCase() === 'wal',
			foreignKeys,
			migrations: applied.n,
			expectedMigrations: expected.length,
			latestMigration: expected[applied.n - 1] ?? null
		};
	} catch {
		return {
			connected: false,
			bytes: 0,
			wal: false,
			foreignKeys: false,
			migrations: 0,
			expectedMigrations: 0,
			latestMigration: null
		};
	}
}

/** Migration tags shipped with this version (drizzle journal). */
export function migrationJournal(): string[] {
	try {
		const journal = JSON.parse(
			fs.readFileSync(path.join(config.migrationsDir, 'meta/_journal.json'), 'utf8')
		) as { entries: { tag: string }[] };
		return journal.entries.map((e) => e.tag);
	} catch {
		return [];
	}
}

export interface BackupRecord {
	createdAt: string;
	file: string;
	bytes: number;
	sha256?: string;
	migrations?: number;
	version?: string;
}

/** The last successful backup written by scripts/backup.js (DATA_DIR/backups/last-backup.json). */
export function lastBackup(): BackupRecord | null {
	try {
		const raw = JSON.parse(
			fs.readFileSync(path.join(config.dataDir, 'backups', 'last-backup.json'), 'utf8')
		) as BackupRecord;
		return raw && typeof raw.createdAt === 'string'
			? { ...raw, file: path.basename(String(raw.file)) }
			: null;
	} catch {
		return null;
	}
}

/** Backup files in DATA_DIR/backups (names and sizes only, newest first). */
export function backupFiles(limit = 10) {
	const dir = path.join(config.dataDir, 'backups');
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => /^tikket-.*\.(db|tar|tar\.gz|tgz)$/.test(f))
			.map((f) => {
				const st = fs.statSync(path.join(dir, f));
				return { name: f, bytes: st.size, modifiedAt: st.mtime };
			})
			.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
			.slice(0, limit);
	} catch {
		return [];
	}
}

export function storageStatus() {
	const data = dirSize(config.dataDir);
	const uploads = dirSize(config.uploadsDir);
	return {
		dataWritable: writable(config.dataDir),
		uploadsWritable: writable(config.uploadsDir),
		dataBytes: data.bytes,
		uploadBytes: uploads.bytes,
		uploadFiles: uploads.files,
		partial: data.partial || uploads.partial,
		disk: diskSpace(config.dataDir)
	};
}

function integrationCounts() {
	const db = getDb();
	const hooks = db
		.select({ kind: schema.projectHooks.kind, n: count() })
		.from(schema.projectHooks)
		.where(eq(schema.projectHooks.enabled, true))
		.groupBy(schema.projectHooks.kind)
		.all();
	const github = db.select({ n: count() }).from(schema.githubConnections).get()?.n ?? 0;
	return {
		smtpConfigured: !!effectiveSmtp(),
		emailEnabled: emailEnabled(),
		github,
		discord: hooks.find((h) => h.kind === 'discord')?.n ?? 0,
		webhooks: hooks.find((h) => h.kind === 'webhook')?.n ?? 0
	};
}

export type HealthWarning = { level: 'warn' | 'error'; message: string };

export function healthReport(now = Date.now()) {
	const db = databaseStatus();
	const storage = storageStatus();
	const queue = queueOverview(now);
	const integrations = integrationCounts();
	const backup = lastBackup();
	const encryption = encryptionAvailable();
	const warnings: HealthWarning[] = [];
	if (!db.connected) warnings.push({ level: 'error', message: 'The database cannot be read.' });
	if (db.connected && db.migrations < db.expectedMigrations)
		warnings.push({ level: 'error', message: 'Database migrations are pending – restart Tikket.' });
	if (db.connected && !db.wal)
		warnings.push({ level: 'warn', message: 'SQLite is not in WAL mode (slower, more locking).' });
	if (!storage.dataWritable || !storage.uploadsWritable)
		warnings.push({ level: 'error', message: 'The data volume is not writable.' });
	if (storage.disk && storage.disk.total > 0 && storage.disk.free / storage.disk.total < 0.1)
		warnings.push({ level: 'warn', message: 'Less than 10 % free space on the data volume.' });
	if (queue.failed)
		warnings.push({
			level: 'warn',
			message: `${queue.failed} failed deliver${queue.failed === 1 ? 'y' : 'ies'} in the queue.`
		});
	if (!backup)
		warnings.push({ level: 'warn', message: 'No backup has been recorded on this server yet.' });
	else if (now - new Date(backup.createdAt).getTime() > 8 * 864e5)
		warnings.push({ level: 'warn', message: 'The last recorded backup is more than a week old.' });
	if (!integrations.smtpConfigured)
		warnings.push({ level: 'warn', message: 'Email is not configured (optional).' });
	if (!encryption)
		warnings.push({
			level: 'warn',
			message: 'ENCRYPTION_KEY is not set: integrations that store secrets are unavailable.'
		});
	return {
		app: {
			version: APP_VERSION,
			uptimeSeconds: Math.round(process.uptime()),
			startedAt,
			environment: process.env.NODE_ENV ?? 'development',
			now: new Date(now),
			publicUrl: config.appUrl || null
		},
		db,
		storage,
		queue,
		integrations,
		backup,
		encryption,
		warnings
	};
}
