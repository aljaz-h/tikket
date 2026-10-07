import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { IMAGE_MIME_TYPES, THEMES } from '../shared/constants';
import { config } from './config';
import { getDb, schema } from './db';

export const settingsSchema = z.object({
	appName: z.string().trim().min(1).max(60),
	appUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]),
	registrationEnabled: z.boolean(),
	allowUserProjectCreation: z.boolean(),
	defaultTheme: z.enum(THEMES),
	maxAttachmentSizeMb: z.number().int().min(1).max(100),
	maxAttachmentsPerTicket: z.number().int().min(1).max(50),
	allowedImageTypes: z.array(z.enum(IMAGE_MIME_TYPES)).min(1),
	sessionLifetimeDays: z.number().int().min(1).max(365),
	invitationLifetimeDays: z.number().int().min(1).max(90)
});

export type AppSettings = z.infer<typeof settingsSchema>;

export function defaultSettings(): AppSettings {
	return {
		appName: 'Tikket',
		appUrl: config.appUrl,
		registrationEnabled: false,
		allowUserProjectCreation: false,
		defaultTheme: 'dark',
		maxAttachmentSizeMb: Math.max(1, Math.min(100, Math.floor(config.maxUploadSize / 1024 / 1024))),
		maxAttachmentsPerTicket: 10,
		allowedImageTypes: [...IMAGE_MIME_TYPES],
		sessionLifetimeDays: 30,
		invitationLifetimeDays: 7
	};
}

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
	if (cache) return cache;
	const rows = getDb().select().from(schema.appSettings).all();
	const stored: Record<string, unknown> = {};
	for (const row of rows) stored[row.key] = row.value;
	const merged = { ...defaultSettings(), ...stored };
	const parsed = settingsSchema.safeParse(merged);
	cache = parsed.success ? parsed.data : defaultSettings();
	return cache;
}

/** Effective per-file upload limit in bytes: the admin setting, capped by MAX_UPLOAD_SIZE. */
export function maxAttachmentBytes(): number {
	return Math.min(getSettings().maxAttachmentSizeMb * 1024 * 1024, config.maxUploadSize);
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
	const next = settingsSchema.parse({ ...getSettings(), ...patch });
	const db = getDb();
	db.transaction((tx) => {
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) continue;
			const v = next[key as keyof AppSettings];
			tx.insert(schema.appSettings)
				.values({ key, value: v, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: schema.appSettings.key,
					set: { value: v, updatedAt: new Date() }
				})
				.run();
		}
	});
	cache = next;
	return next;
}

export function invalidateSettingsCache() {
	cache = null;
}

/** Internal flags that are not user-editable settings. */
export function getFlag(key: string): unknown {
	const row = getDb()
		.select()
		.from(schema.appSettings)
		.where(eq(schema.appSettings.key, `flag:${key}`))
		.get();
	return row?.value;
}

export function setFlag(key: string, value: unknown) {
	getDb()
		.insert(schema.appSettings)
		.values({ key: `flag:${key}`, value })
		.onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } })
		.run();
}
