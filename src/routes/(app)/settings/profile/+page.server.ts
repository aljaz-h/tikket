import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/db';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { getUser, setAvatar, setTheme, updateProfile } from '$lib/server/services/users';
import { findAttachment, removeFiles, storeImage, UploadError } from '$lib/server/uploads';
import { parseForm, profileSchema } from '$lib/server/validation';
import { THEMES, type Theme } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = getUser(locals.user!.id)!;
	return {
		title: 'Profile',
		profile: {
			displayName: user.displayName,
			username: user.username,
			email: user.email,
			bio: user.bio ?? '',
			avatarId: user.avatarId,
			theme: user.theme
		}
	};
};

function dropAvatar(id: string | null) {
	if (!id) return;
	const att = findAttachment(id);
	if (!att) return;
	getDb()
		.update(schema.attachments)
		.set({ deletedAt: new Date() })
		.where(eq(schema.attachments.id, id))
		.run();
	removeFiles(att);
}

export const actions: Actions = {
	profile: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const parsed = parseForm(profileSchema, form);
		if (!parsed.ok) return parsed.failure;
		try {
			updateProfile(user.id, parsed.data);
		} catch (err) {
			return handleServiceError(
				err,
				Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
			);
		}
		return { saved: 'profile' };
	},
	avatar: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const wait = limiters.upload.hit(`upload:${user.id}`);
		if (wait)
			return fail(429, {
				errors: { avatar: `Too many uploads. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const file = (await request.formData()).get('avatar');
		if (!(file instanceof File) || !file.size)
			return fail(400, { errors: { avatar: 'Choose an image' }, values: {} });
		try {
			const att = await storeImage(file, { uploaderId: user.id, kind: 'avatar' });
			const previous = getUser(user.id)?.avatarId ?? null;
			setAvatar(user.id, att.id);
			dropAvatar(previous);
		} catch (err) {
			if (err instanceof UploadError)
				return fail(400, { errors: { avatar: err.message }, values: {} });
			throw err;
		}
		return { saved: 'avatar' };
	},
	removeAvatar: async ({ locals }) => {
		const user = requireActionUser(locals);
		const previous = getUser(user.id)?.avatarId ?? null;
		setAvatar(user.id, null);
		dropAvatar(previous);
		return { saved: 'avatar' };
	},
	theme: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const theme = String((await request.formData()).get('theme')) as Theme;
		if (!THEMES.includes(theme))
			return fail(400, { errors: { theme: 'Invalid theme' }, values: {} });
		setTheme(user.id, theme);
		return { saved: 'theme' };
	}
};
