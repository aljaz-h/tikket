import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { getStoredSmtp, SMTP_PURPOSE } from './email/config';
import {
	decryptSecret,
	encryptionAvailable,
	encryptSecret,
	needsRotation,
	KEY_HINT
} from './secrets';

/**
 * Every encrypted value in the database, with its purpose (AAD). Used at start-up to refuse
 * running with stored secrets but no key, and to re-encrypt values after a key rotation.
 */
interface SecretRef {
	label: string;
	purpose: string;
	value: string;
	save: (next: string) => void;
}

function collect(): SecretRef[] {
	const db = getDb();
	const refs: SecretRef[] = [];
	for (const h of db.select().from(schema.projectHooks).all()) {
		refs.push({
			label: `${h.kind} “${h.name}” URL`,
			purpose: 'hook:url',
			value: h.urlEnc,
			save: (v) =>
				db
					.update(schema.projectHooks)
					.set({ urlEnc: v })
					.where(eq(schema.projectHooks.id, h.id))
					.run()
		});
		if (h.secretEnc)
			refs.push({
				label: `webhook “${h.name}” signing secret`,
				purpose: 'hook:secret',
				value: h.secretEnc,
				save: (v) =>
					db
						.update(schema.projectHooks)
						.set({ secretEnc: v })
						.where(eq(schema.projectHooks.id, h.id))
						.run()
			});
	}
	for (const c of db.select().from(schema.githubConnections).all()) {
		refs.push({
			label: `GitHub ${c.owner}/${c.repo} webhook secret`,
			purpose: 'github:webhook',
			value: c.webhookSecretEnc,
			save: (v) =>
				db
					.update(schema.githubConnections)
					.set({ webhookSecretEnc: v })
					.where(eq(schema.githubConnections.id, c.id))
					.run()
		});
		if (c.tokenEnc)
			refs.push({
				label: `GitHub ${c.owner}/${c.repo} token`,
				purpose: 'github:token',
				value: c.tokenEnc,
				save: (v) =>
					db
						.update(schema.githubConnections)
						.set({ tokenEnc: v })
						.where(eq(schema.githubConnections.id, c.id))
						.run()
			});
	}
	const smtp = getStoredSmtp();
	if (smtp?.passwordEnc)
		refs.push({
			label: 'SMTP password',
			purpose: SMTP_PURPOSE,
			value: smtp.passwordEnc,
			save: (v) =>
				db
					.update(schema.appSettings)
					.set({ value: { ...smtp, passwordEnc: v } })
					.where(eq(schema.appSettings.key, 'smtp'))
					.run()
		});
	// Values cleared with scripts/forget-secrets.js are empty and need no key.
	return refs.filter((r) => r.value !== '');
}

/**
 * Start-up check. Without ENCRYPTION_KEY, stored integration secrets would be unusable, so the
 * start fails with instructions instead of silently breaking deliveries. With a key, values
 * encrypted with a previous key (ENCRYPTION_KEY_PREVIOUS) are re-encrypted with the current one,
 * and values no configured key can read are reported.
 */
export function checkStoredSecrets() {
	const refs = collect();
	if (!refs.length) return { rotated: 0, unreadable: [] as string[] };
	if (!encryptionAvailable())
		throw new Error(
			`The database contains ${refs.length} encrypted integration secret(s) but ENCRYPTION_KEY is not set. ` +
				'Set the same ENCRYPTION_KEY that was used to store them. ' +
				`${KEY_HINT}. If the key is lost, see "Lost encryption key" in docs/integrations.md.`
		);
	let rotated = 0;
	const unreadable: string[] = [];
	for (const ref of refs) {
		try {
			const plain = decryptSecret(ref.value, ref.purpose);
			if (needsRotation(ref.value)) {
				ref.save(encryptSecret(plain, ref.purpose));
				rotated++;
			}
		} catch {
			unreadable.push(ref.label);
		}
	}
	if (rotated)
		console.info(`[tikket] re-encrypted ${rotated} secret(s) with the current ENCRYPTION_KEY`);
	if (unreadable.length)
		console.warn(
			`[tikket] warning: ${unreadable.length} stored secret(s) cannot be decrypted with the configured key(s): ${unreadable.join(', ')}. ` +
				'Those integrations will report an error until the original key is restored or the secret is entered again.'
		);
	return { rotated, unreadable };
}
