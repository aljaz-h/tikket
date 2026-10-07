import { fail, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { formatWait, RateLimiter } from '$lib/server/auth/rate-limit';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import { createImport, IMPORT_LIMITS, listImports } from '$lib/server/services/import';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

const uploads = new RateLimiter(20, 60 * 60 * 1000);

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Import · Settings · ${access.project.name}`,
		imports: listImports(access.project.id),
		limits: { tickets: IMPORT_LIMITS.tickets, megabytes: IMPORT_LIMITS.bytes / 1024 / 1024 }
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const wait = uploads.hit(`import:${user.id}`);
		if (wait)
			return fail(429, { errors: { file: `Too many uploads. Try again in ${formatWait(wait)}.` } });
		const file = (await request.formData()).get('file');
		if (!(file instanceof File) || !file.size)
			return fail(400, { errors: { file: 'Choose a file to import' } });
		if (file.size > IMPORT_LIMITS.bytes)
			return fail(400, { errors: { file: 'The file is larger than 10 MB' } });
		let id: string;
		try {
			id = createImport(user.id, access, {
				name: file.name,
				size: file.size,
				text: await file.text()
			});
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, `settings/import/${id}`));
	}
};
