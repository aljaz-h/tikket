import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { validateEnvironment } from './env-check';

let ready = false;

/** True once configuration is validated and the database is migrated and open. */
export function isReady() {
	return ready;
}

export function markReady() {
	ready = true;
}

/** Fails fast with actionable messages when the deployment is misconfigured. */
export function checkConfiguration(env: Record<string, string | undefined> = process.env) {
	const { errors, warnings } = validateEnvironment(env);
	for (const warning of warnings) console.warn(`[tikket] warning: ${warning}`);
	if (errors.length) {
		const message = `Invalid configuration:\n  - ${errors.join('\n  - ')}`;
		console.error(`[tikket] ${message}`);
		throw new Error(message);
	}
}

/** Verifies that the data directory (database, uploads, generated secret) is writable. */
export function checkDataDirectory() {
	const dirs = [config.dataDir, path.dirname(config.databasePath), config.uploadsDir];
	for (const dir of new Set(dirs)) {
		try {
			fs.mkdirSync(dir, { recursive: true });
			const probe = path.join(dir, `.write-test-${process.pid}`);
			fs.writeFileSync(probe, '');
			fs.unlinkSync(probe);
		} catch (err) {
			const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
			const message =
				`Data directory "${dir}" is not writable by uid ${uid} (${err instanceof Error ? err.message : err}). ` +
				'Mount a persistent volume there and make sure it is owned by the application user ' +
				'(the Docker image runs as uid 1000: chown -R 1000:1000 <volume path>).';
			console.error(`[tikket] ${message}`);
			throw new Error(message, { cause: err });
		}
	}
}
