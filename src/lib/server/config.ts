import path from 'node:path';

/**
 * Environment-based configuration. Read lazily so tests and scripts can adjust
 * process.env before the first access.
 */
function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Parses sizes such as "10M", "512K" or plain bytes. */
export function parseSize(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const match = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)b?\s*$/i.exec(raw);
	if (!match) return fallback;
	const unit = match[2].toLowerCase();
	const factor = unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1;
	return Math.floor(Number(match[1]) * factor);
}

export const config = {
	get dataDir() {
		return path.resolve(process.env.DATA_DIR ?? './data');
	},
	get databasePath() {
		return path.resolve(process.env.DATABASE_PATH ?? path.join(this.dataDir, 'tikket.db'));
	},
	get uploadsDir() {
		return path.resolve(process.env.UPLOADS_DIR ?? path.join(this.dataDir, 'uploads'));
	},
	get migrationsDir() {
		return path.resolve(process.env.MIGRATIONS_DIR ?? './drizzle');
	},
	/** Hard upper bound for a single uploaded file (admins can lower it in settings). */
	get maxUploadSize() {
		return parseSize(process.env.MAX_UPLOAD_SIZE, 10 * 1024 * 1024);
	},
	get sessionSecret() {
		return process.env.SESSION_SECRET;
	},
	get appUrl() {
		return process.env.APP_URL ?? process.env.ORIGIN ?? '';
	},
	get loginRateLimit() {
		return envInt('LOGIN_RATE_LIMIT', 10);
	},
	get isTest() {
		return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
	}
};
