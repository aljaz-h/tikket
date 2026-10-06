// Emergency recovery: prints a single-use password reset link for a user (e.g. the only admin).
// Usage: node scripts/reset-link.js <username-or-email>
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

const who = process.argv[2];
if (!who) {
	console.error('Usage: node scripts/reset-link.js <username-or-email>');
	process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const db = new Database(
	path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'tikket.db')),
	{ fileMustExist: true }
);
db.pragma('busy_timeout = 5000');
const user = db
	.prepare(
		'select id, username from users where lower(username) = lower(?) or lower(email) = lower(?)'
	)
	.get(who, who);
if (!user) {
	console.error(`No user "${who}"`);
	process.exit(1);
}
const token = randomBytes(32).toString('base64url');
const now = Date.now();
db.transaction(() => {
	db.prepare('update password_resets set used_at = ? where user_id = ? and used_at is null').run(
		now,
		user.id
	);
	db.prepare(
		'insert into password_resets (token_hash, user_id, expires_at, created_at) values (?, ?, ?, ?)'
	).run(createHash('sha256').update(token).digest('hex'), user.id, now + 60 * 60 * 1000, now);
	db.prepare(
		"insert into audit_logs (action, target_type, target_id, data, created_at) values ('user.password_reset_issued', 'user', ?, '{\"via\":\"cli\"}', ?)"
	).run(String(user.id), now);
})();
db.close();
const base = (process.env.APP_URL || process.env.ORIGIN || '').replace(/\/$/, '');
console.log(`Reset link for @${user.username} (valid 1 hour, single use):\n${base}/reset/${token}`);
