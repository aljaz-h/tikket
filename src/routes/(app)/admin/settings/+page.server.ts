import { fail } from '@sveltejs/kit';
import { adminActor } from '$lib/server/admin';
import { config } from '$lib/server/config';
import { audit } from '$lib/server/services/audit';
import { getSettings, settingsSchema, updateSettings } from '$lib/server/settings';
import { zodErrors } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminActor(locals);
	return { title: 'System settings', settings: getSettings(), hardUploadLimitMb: Math.floor(config.maxUploadSize / 1024 / 1024) };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const form = await request.formData();
		const candidate = {
			appName: String(form.get('appName') ?? ''),
			appUrl: String(form.get('appUrl') ?? '').trim().replace(/\/$/, ''),
			registrationEnabled: form.get('registrationEnabled') === 'on',
			allowUserProjectCreation: form.get('allowUserProjectCreation') === 'on',
			defaultTheme: String(form.get('defaultTheme') ?? 'dark'),
			maxAttachmentSizeMb: Number(form.get('maxAttachmentSizeMb')),
			maxAttachmentsPerTicket: Number(form.get('maxAttachmentsPerTicket')),
			allowedImageTypes: form.getAll('allowedImageTypes').map(String),
			sessionLifetimeDays: Number(form.get('sessionLifetimeDays')),
			invitationLifetimeDays: Number(form.get('invitationLifetimeDays'))
		};
		const parsed = settingsSchema.safeParse(candidate);
		if (!parsed.success) return fail(400, { errors: zodErrors(parsed.error), values: {} });
		const before = getSettings();
		const next = updateSettings(parsed.data);
		const changed = Object.keys(next).filter((k) => JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(before[k as keyof typeof before]));
		if (changed.length)
			audit({ actorId: admin.id, action: 'settings.updated', targetType: 'settings', data: Object.fromEntries(changed.map((k) => [k, next[k as keyof typeof next]])), ip: locals.clientIp });
		return { saved: true };
	}
};
