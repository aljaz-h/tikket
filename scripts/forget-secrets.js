// Emergency recovery after losing ENCRYPTION_KEY: removes every stored (unreadable) integration
// secret so Tikket can start again. Integrations stay configured but are disabled until the
// secrets are entered again: Discord / webhook destinations need a new URL, GitHub needs a new
// webhook secret (and token), and the SMTP password must be re-entered.
//
// Usage (stop Tikket first):  node scripts/forget-secrets.js --yes
import Database from 'better-sqlite3';
import path from 'node:path';

if (!process.argv.includes('--yes')) {
	console.error(
		'This permanently removes all stored integration secrets (webhook URLs, signing secrets,\n' +
			'GitHub secrets and tokens, the SMTP password). Run again with --yes to continue.'
	);
	process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const db = new Database(
	path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'tikket.db')),
	{ fileMustExist: true }
);
db.pragma('busy_timeout = 5000');
const note = 'Secret removed after the encryption key was lost – enter it again.';
const now = Date.now();
const result = db.transaction(() => {
	const hooks = db
		.prepare(
			`update project_hooks set url_enc = '', secret_enc = null, enabled = 0, last_error = ?,
			 last_failure_at = ?, url_hint = url_hint || ' (needs a new URL)' where url_enc <> ''`
		)
		.run(note, now).changes;
	// Pending deliveries for those destinations cannot be sent any more.
	db.prepare(
		`update outbound_jobs set status = 'dead', last_error = ?, finished_at = ?
		 where status in ('pending', 'running') and hook_id is not null`
	).run(note, now);
	const github = db
		.prepare(
			`update github_connections set webhook_secret_enc = '', token_enc = null,
			 last_error = ?, last_error_at = ? where webhook_secret_enc <> ''`
		)
		.run(note, now).changes;
	const row = db.prepare(`select value from app_settings where key = 'smtp'`).get();
	let smtp = 0;
	if (row) {
		const value = JSON.parse(row.value);
		if (value.passwordEnc) {
			value.passwordEnc = null;
			db.prepare(`update app_settings set value = ? where key = 'smtp'`).run(JSON.stringify(value));
			smtp = 1;
		}
	}
	return { hooks, github, smtp };
})();
console.log(
	`Removed secrets of ${result.hooks} Discord/webhook destination(s), ${result.github} GitHub connection(s)` +
		`${result.smtp ? ' and the SMTP password' : ''}. Set a new ENCRYPTION_KEY, start Tikket and re-enter them.`
);
