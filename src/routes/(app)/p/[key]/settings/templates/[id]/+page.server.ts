import { error, fail, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { getTemplate, saveTemplate, templateSchema } from '$lib/server/services/templates';
import { TICKET_TYPES, type TicketType } from '$lib/shared/constants';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	if (params.id === 'new') {
		const type = url.searchParams.get('type') as TicketType;
		return {
			title: 'New template',
			template: {
				id: null,
				type: TICKET_TYPES.includes(type) ? type : 'bug',
				name: '',
				description: '',
				enabled: true,
				isDefault: true,
				version: 0,
				fields: []
			}
		};
	}
	const id = intParam(params.id);
	const template = id ? getTemplate(access.project.id, id) : undefined;
	if (!template) error(404, 'Template not found');
	return { title: `Edit ${template.name}`, template };
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const raw = String((await request.formData()).get('payload') ?? '');
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return fail(400, { errors: { form: 'The template could not be read. Please try again.' } });
		}
		const parsed = templateSchema.safeParse(json);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const where =
				issue.path[0] === 'fields' && typeof issue.path[1] === 'number'
					? `Question ${issue.path[1] + 1}: `
					: '';
			return fail(400, { errors: { form: where + issue.message } });
		}
		if (params.id !== 'new') parsed.data.id = intParam(params.id) ?? undefined;
		try {
			saveTemplate(access.project, parsed.data);
		} catch (err) {
			return handleServiceError(err);
		}
		redirect(303, projectPath(access.project.key, 'settings/templates'));
	}
};
