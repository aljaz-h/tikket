// Backup verification shared by scripts/backup-verify.js and scripts/restore-verify.js.
// Reads a backup (a .db snapshot or a .tar/.tar.gz archive of the data volume), never modifies
// it, and never touches the live data directory: everything is copied into a temporary directory
// that is removed afterwards.
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const MAX_ARCHIVE_BYTES = 4 * 1024 ** 3;
const REQUIRED_TABLES = [
	'users',
	'projects',
	'project_members',
	'tickets',
	'ticket_comments',
	'attachments',
	'__drizzle_migrations'
];

/** @typedef {{ level: 'ok' | 'warn' | 'error'; message: string }} Check */
/** @typedef {{ name: string; type: 'file' | 'dir'; data?: Buffer; size: number }} TarEntry */

export class ArchiveError extends Error {}

/** Rejects absolute paths, `..` segments, backslashes and drive letters. */
export function safeEntryName(name) {
	const clean = name.replace(/^\.\//, '');
	if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.includes('\\'))
		throw new ArchiveError(`Unsafe path in archive: ${JSON.stringify(name)}`);
	if (clean.split('/').some((part) => part === '..'))
		throw new ArchiveError(`Path traversal in archive: ${JSON.stringify(name)}`);
	return clean.replace(/\/$/, '');
}

const str = (buf, start, len) => {
	const end = buf.indexOf(0, start);
	return buf.toString('utf8', start, end === -1 || end > start + len ? start + len : end);
};
const octal = (buf, start, len) => {
	const s = str(buf, start, len).trim();
	if (!s) return 0;
	if (!/^[0-7]+$/.test(s)) throw new ArchiveError('Corrupt tar header (invalid number)');
	return parseInt(s, 8);
};

/**
 * Minimal, strict tar reader (ustar, GNU long names, pax `path`). Only regular files and
 * directories are accepted; links, devices and FIFOs are rejected. Header checksums are verified.
 * @param {Buffer} buf
 * @returns {TarEntry[]}
 */
export function readTar(buf) {
	/** @type {TarEntry[]} */
	const entries = [];
	let offset = 0;
	let longName = null;
	let paxPath = null;
	let ended = false;
	while (offset + 512 <= buf.length) {
		const header = buf.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) {
			ended = true;
			break;
		}
		const stored = octal(header, 148, 8);
		let sum = 0;
		for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
		if (sum !== stored) throw new ArchiveError('Corrupt tar header (checksum mismatch)');
		const size = octal(header, 124, 12);
		const type = String.fromCharCode(header[156] || 48);
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		if (dataEnd > buf.length) throw new ArchiveError('Truncated archive');
		const data = buf.subarray(dataStart, dataEnd);
		offset = dataStart + Math.ceil(size / 512) * 512;
		if (type === 'L') {
			longName = data.toString('utf8').replace(/\0+$/, '');
			continue;
		}
		if (type === 'x') {
			const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
			if (m) paxPath = m[1];
			continue;
		}
		if (type === 'g') continue;
		const prefix = str(header, 345, 155);
		const rawName =
			paxPath ?? longName ?? (prefix ? `${prefix}/${str(header, 0, 100)}` : str(header, 0, 100));
		longName = paxPath = null;
		if (type === '1' || type === '2')
			throw new ArchiveError(`Links are not allowed in a backup: ${JSON.stringify(rawName)}`);
		if (type !== '0' && type !== '5' && type !== '7')
			throw new ArchiveError(
				`Unsupported archive entry type "${type}": ${JSON.stringify(rawName)}`
			);
		const name = safeEntryName(rawName);
		if (!name) continue;
		entries.push(
			type === '5' ? { name, type: 'dir', size: 0 } : { name, type: 'file', data, size }
		);
	}
	if (!ended && offset < buf.length) throw new ArchiveError('Truncated archive');
	if (!entries.length) throw new ArchiveError('The archive is empty');
	return entries;
}

/** Reads the file and unpacks gzip if needed. */
function readArchive(file) {
	const size = fs.statSync(file).size;
	if (size > MAX_ARCHIVE_BYTES) throw new ArchiveError('The archive is larger than 4 GB');
	let buf = fs.readFileSync(file);
	if (buf[0] === 0x1f && buf[1] === 0x8b) {
		try {
			buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_ARCHIVE_BYTES });
		} catch (err) {
			throw new ArchiveError(`Corrupt or truncated gzip data (${err.code ?? err.message})`);
		}
	}
	return readTar(buf);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Migration tags shipped with this version of Tikket. */
export function journalTags(migrationsDir) {
	const journal = JSON.parse(
		fs.readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8')
	);
	return journal.entries.map((e) => e.tag);
}

/**
 * Locates the database and upload files of a backup and copies the database into `tmp`.
 * @returns {{ dbFile: string; dbSource: string; uploads: Map<string, number> | null; manifest: any; checks: Check[] }}
 */
function loadBackup(input, tmp, opts) {
	/** @type {Check[]} */
	const checks = [];
	const isArchive = /\.(tar|tar\.gz|tgz)$/i.test(input) || isGzipOrTar(input);
	if (!isArchive) {
		const dbFile = path.join(tmp, 'backup.db');
		fs.copyFileSync(input, dbFile);
		checks.push({ level: 'ok', message: 'Database snapshot found' });
		let manifest = null;
		const sidecar = input.replace(/\.db$/i, '.json');
		if (sidecar !== input && fs.existsSync(sidecar)) {
			manifest = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
			const actual = sha256(fs.readFileSync(input));
			if (manifest.sha256 && manifest.sha256 !== actual)
				checks.push({
					level: 'error',
					message: 'Checksum mismatch: the snapshot differs from its metadata'
				});
			else if (manifest.sha256)
				checks.push({ level: 'ok', message: 'Snapshot checksum matches its metadata' });
		}
		let uploads = null;
		if (opts.uploads) {
			uploads = new Map();
			const walk = (dir, rel = '') => {
				for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
					const r = rel ? `${rel}/${e.name}` : e.name;
					if (e.isDirectory()) walk(path.join(dir, e.name), r);
					else if (e.isFile()) uploads.set(r, fs.statSync(path.join(dir, e.name)).size);
				}
			};
			walk(opts.uploads);
		}
		return { dbFile, dbSource: path.basename(input), uploads, manifest, checks };
	}
	const entries = readArchive(input);
	checks.push({ level: 'ok', message: `Archive structure is valid (${entries.length} entries)` });
	const files = entries.filter((e) => e.type === 'file');
	const snapshots = files
		.filter((e) => /(^|\/)backups\/tikket-[^/]+\.db$/.test(e.name))
		.sort((a, b) => a.name.localeCompare(b.name));
	const live = files.find((e) => /(^|\/)tikket\.db$/.test(e.name));
	const db = snapshots.at(-1) ?? live;
	if (!db)
		throw new ArchiveError('No database found in the archive (backups/tikket-*.db or tikket.db)');
	if (!snapshots.length)
		checks.push({
			level: 'warn',
			message:
				'Only a live tikket.db was found – it is consistent only if Tikket was stopped when archiving'
		});
	const dbFile = path.join(tmp, 'backup.db');
	fs.writeFileSync(dbFile, db.data);
	let manifest = null;
	const sidecar = files.find((e) => e.name === db.name.replace(/\.db$/, '.json'));
	if (sidecar) {
		manifest = JSON.parse(sidecar.data.toString('utf8'));
		if (manifest.sha256 && manifest.sha256 !== sha256(db.data))
			checks.push({
				level: 'error',
				message: 'Checksum mismatch: the snapshot differs from its metadata'
			});
		else if (manifest.sha256)
			checks.push({ level: 'ok', message: 'Snapshot checksum matches its metadata' });
	}
	const uploads = new Map();
	let uploadRoot = null;
	for (const e of files) {
		const m = /^(?:.*\/)?uploads\/(.+)$/.exec(e.name);
		if (m) {
			uploads.set(m[1], e.size);
			uploadRoot = true;
		}
	}
	return {
		dbFile,
		dbSource: db.name,
		uploads: uploadRoot || entries.some((e) => /(^|\/)uploads$/.test(e.name)) ? uploads : null,
		manifest,
		checks
	};
}

function isGzipOrTar(file) {
	const fd = fs.openSync(file, 'r');
	try {
		const head = Buffer.alloc(512);
		const n = fs.readSync(fd, head, 0, 512, 0);
		if (n >= 2 && head[0] === 0x1f && head[1] === 0x8b) return true;
		return n === 512 && head.toString('latin1', 257, 262) === 'ustar';
	} finally {
		fs.closeSync(fd);
	}
}

/**
 * Verifies a backup. Never modifies it.
 * @param {string} input path to the backup file
 * @param {{ migrationsDir: string; uploads?: string; migrate?: (dbFile: string) => { applied: number; total: number } }} opts
 */
export function verifyBackup(input, opts) {
	/** @type {Check[]} */
	const checks = [];
	const result = { file: path.basename(input), checks, restorable: false, details: {} };
	if (!fs.existsSync(input)) {
		checks.push({ level: 'error', message: 'The backup file does not exist' });
		return result;
	}
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-verify-'));
	try {
		let loaded;
		try {
			loaded = loadBackup(input, tmp, opts);
		} catch (err) {
			checks.push({
				level: 'error',
				message:
					err instanceof ArchiveError ? err.message : `Cannot read the backup: ${err.message}`
			});
			return result;
		}
		checks.push(...loaded.checks);
		result.details.database = loaded.dbSource;
		if (loaded.manifest) {
			result.details.createdAt = loaded.manifest.createdAt;
			result.details.version = loaded.manifest.version ?? loaded.manifest.appVersion;
			checks.push({
				level: 'ok',
				message: `Backup metadata present (created ${loaded.manifest.createdAt ?? 'unknown'})`
			});
		} else
			checks.push({
				level: 'warn',
				message:
					'No backup metadata (.json) found – created by an older backup script or copied manually'
			});

		let db;
		try {
			db = new Database(loaded.dbFile, { readonly: true, fileMustExist: true });
			const integrity = db.pragma('integrity_check', { simple: true });
			if (integrity !== 'ok') {
				checks.push({
					level: 'error',
					message: `SQLite integrity check failed: ${String(integrity).slice(0, 200)}`
				});
				return result;
			}
			checks.push({ level: 'ok', message: 'SQLite opens and passes the integrity check' });
		} catch (err) {
			checks.push({
				level: 'error',
				message: `Not a valid SQLite database (${err.code ?? err.message})`
			});
			return result;
		}
		try {
			const tables = new Set(
				db
					.prepare("select name from sqlite_master where type = 'table'")
					.all()
					.map((r) => r.name)
			);
			const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
			if (missing.length) {
				checks.push({
					level: 'error',
					message: `Not a Tikket database: missing tables ${missing.join(', ')}`
				});
				return result;
			}
			checks.push({ level: 'ok', message: 'All required Tikket tables are present' });
			const fk = db.pragma('foreign_key_check');
			if (fk.length)
				checks.push({ level: 'warn', message: `${fk.length} foreign key problem(s) found` });

			const applied = db.prepare('select count(*) as n from __drizzle_migrations').get().n;
			const expected = journalTags(opts.migrationsDir);
			result.details.migrations = { applied, expected: expected.length };
			if (applied > expected.length) {
				checks.push({
					level: 'error',
					message: `The backup is from a newer Tikket (schema ${applied}, this version knows ${expected.length}) – restore it with that version or newer`
				});
				return result;
			}
			if (applied < expected.length)
				checks.push({
					level: 'ok',
					message: `Schema ${applied} of ${expected.length}: older backup, pending migrations are applied automatically on start`
				});
			else
				checks.push({
					level: 'ok',
					message: `Schema version matches this Tikket (${applied} migrations)`
				});

			const counts = {
				users: db.prepare('select count(*) as n from users').get().n,
				projects: db.prepare('select count(*) as n from projects').get().n,
				tickets: db.prepare('select count(*) as n from tickets').get().n
			};
			result.details.counts = counts;
			checks.push({
				level: 'ok',
				message: `Contains ${counts.users} users, ${counts.projects} projects, ${counts.tickets} tickets`
			});

			// Attachment files referenced by the database.
			const cols = new Set(
				db
					.prepare('pragma table_info(attachments)')
					.all()
					.map((c) => c.name)
			);
			const rows = db
				.prepare(
					`select id, extension, size from attachments where ${cols.has('deleted_at') ? 'deleted_at is null and ' : ''}(attached_at is not null or kind is not null)`
				)
				.all();
			result.details.attachments = {
				count: rows.length,
				bytes: rows.reduce((n, r) => n + (r.size ?? 0), 0)
			};
			if (!loaded.uploads) {
				checks.push({
					level: 'warn',
					message: `${rows.length} attachment(s) referenced – upload files not checked (pass --uploads <dir> or verify the full archive)`
				});
			} else {
				const missing = rows.filter(
					(r) => !loaded.uploads.has(`${r.id.slice(0, 2)}/${r.id}.${r.extension}`)
				);
				result.details.missingUploads = missing.length;
				if (missing.length)
					checks.push({
						level: 'warn',
						message: `${missing.length} of ${rows.length} attachment file(s) are missing – those images will appear broken`
					});
				else
					checks.push({
						level: 'ok',
						message: `All ${rows.length} attachment file(s) are present`
					});
			}

			// Encrypted secrets need the same ENCRYPTION_KEY.
			const has = (table, col) =>
				tables.has(table) &&
				db
					.prepare(`select count(*) as n from ${table} where ${col} is not null and ${col} != ''`)
					.get().n > 0;
			const smtp = tables.has('app_settings')
				? db
						.prepare('select count(*) as n from app_settings where value like \'%passwordEnc":"%\'')
						.get().n > 0
				: false;
			const encrypted =
				has('project_hooks', 'url_enc') || has('github_connections', 'webhook_secret_enc') || smtp;
			result.details.encryptedSecrets = encrypted;
			if (encrypted)
				checks.push({
					level: 'warn',
					message:
						'Contains encrypted integration secrets: restore needs the same ENCRYPTION_KEY, otherwise they must be re-entered'
				});
		} finally {
			db.close();
		}

		if (opts.migrate) {
			try {
				const { applied, total } = opts.migrate(loaded.dbFile);
				checks.push({
					level: 'ok',
					message: `Dry-run restore: migrations applied to a copy (${applied} applied, now ${total})`
				});
			} catch (err) {
				checks.push({
					level: 'error',
					message: `Dry-run restore failed while migrating a copy: ${err.message}`
				});
				return result;
			}
		}
		result.restorable = !checks.some((c) => c.level === 'error');
		return result;
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

export function printResult(result, json) {
	if (json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}
	console.log(`Backup: ${result.file}`);
	for (const c of result.checks)
		console.log(`  ${c.level === 'ok' ? '✓' : c.level === 'warn' ? '⚠' : '✗'} ${c.message}`);
	console.log(`Restorable: ${result.restorable ? 'yes' : 'no'}`);
}
