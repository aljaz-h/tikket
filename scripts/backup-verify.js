// Verifies a backup without modifying it or the live data.
// Usage: node scripts/backup-verify.js <backup.db | backup.tar.gz> [--uploads <dir>] [--json]
import path from 'node:path';
import { printResult, verifyBackup } from './lib/backup-check.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const uploadsAt = args.indexOf('--uploads');
const input = args.find((a, i) => !a.startsWith('--') && (uploadsAt < 0 || i !== uploadsAt + 1));
if (!input) {
	console.error(
		'Usage: npm run backup:verify -- <backup.db | backup.tar.gz> [--uploads <dir>] [--json]'
	);
	process.exit(2);
}
const result = verifyBackup(path.resolve(input), {
	migrationsDir: path.resolve(process.env.MIGRATIONS_DIR || './drizzle'),
	uploads: uploadsAt >= 0 ? path.resolve(args[uploadsAt + 1]) : undefined
});
printResult(result, json);
process.exitCode = result.restorable ? 0 : 1;
