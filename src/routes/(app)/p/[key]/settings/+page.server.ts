import { error, fail, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { FetchError } from '$lib/server/safe-fetch';
import {
	fetchWebsiteIcon,
	requireLogoManager,
	setProjectLogo,
	storeLogo
} from '$lib/server/services/project-logos';
import { updateProject } from '$lib/server/services/projects';
import { UploadError } from '$lib/server/uploads';
import { parseForm, projectSettingsSchema } from '$lib/server/validation';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return { title: `Settings · ${access.project.name}` };
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

function logoFailure(err: unknown) {
	if (err instanceof UploadError || err instanceof FetchError)
		return fail(400, { errors: { logo: err.message }, values: {} });
	return handleServiceError(err);
}

export const actions: Actions = {
	update: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		if (access.archived) error(403, 'Unarchive the project before changing its settings');
		const form = await request.formData();
		const parsed = parseForm(projectSettingsSchema, form);
		if (!parsed.ok) return parsed.failure;
		let key: string;
		try {
			key = updateProject(user.id, access.project, parsed.data, locals.clientIp).key;
		} catch (err) {
			return handleServiceError(
				err,
				Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
			);
		}
		if (key !== access.project.key) redirect(303, projectPath(key, 'settings'));
		return { updated: true };
	},

	uploadLogo: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const wait = limiters.upload.hit(`upload:${user.id}`);
		if (wait)
			return fail(429, {
				errors: { logo: `Too many uploads. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		const file = (await request.formData()).get('logo');
		if (!(file instanceof File) || !file.size)
			return fail(400, { errors: { logo: 'Choose an image' }, values: {} });
		try {
			requireLogoManager(access);
			const att = await storeLogo(Buffer.from(await file.arrayBuffer()), {
				uploaderId: user.id,
				projectId: access.project.id,
				name: file.name,
				pending: true
			});
			setProjectLogo(user.id, access, att.id, locals.clientIp);
		} catch (err) {
			return logoFailure(err);
		}
		return { logo: 'uploaded' };
	},

	removeLogo: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		try {
			setProjectLogo(user.id, access, null, locals.clientIp);
		} catch (err) {
			return logoFailure(err);
		}
		return { logo: 'removed' };
	},

	/** Fetches the website's icon as a pending preview; nothing changes until it is applied. */
	fetchLogo: async ({ locals, params }) => {
		const { user, access } = owner(locals, params.key);
		const wait = limiters.upload.hit(`upload:${user.id}`);
		if (wait)
			return fail(429, {
				errors: { logo: `Too many attempts. Try again in ${formatWait(wait)}.` },
				values: {}
			});
		if (!access.project.url)
			return fail(400, { errors: { logo: 'Add the project website first.' }, values: {} });
		try {
			requireLogoManager(access);
			const image = await fetchWebsiteIcon(access.project.url);
			const att = await storeLogo(image, {
				uploaderId: user.id,
				projectId: access.project.id,
				name: 'website-icon.png',
				pending: true
			});
			return { logoPreview: att.id };
		} catch (err) {
			return logoFailure(err);
		}
	},

	applyLogo: async ({ locals, params, request }) => {
		const { user, access } = owner(locals, params.key);
		const id = String((await request.formData()).get('logoId') ?? '');
		try {
			setProjectLogo(user.id, access, id, locals.clientIp);
		} catch (err) {
			return logoFailure(err);
		}
		return { logo: 'applied' };
	}
};
