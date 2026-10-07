import { error, fail, redirect } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { testRule } from '$lib/server/automations/engine';
import { editorOptions } from '$lib/server/automations/options';
import { createRule, getRule, normaliseRule, updateRule } from '$lib/server/automations/rules';
import { getTicket } from '$lib/server/services/tickets';
import { ServiceError } from '$lib/server/services/users';
import { parseTicketReference } from '$lib/shared/workflow';
import { projectPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'staff');
	const isNew = params.id === 'new';
	const id = isNew ? null : intParam(params.id);
	const rule = id ? getRule(access.project.id, id) : null;
	if (!isNew && !rule) error(404, 'Not found');
	return {
		title: `${rule ? rule.name : 'New automation'} · Automations`,
		rule: rule
			? {
					id: rule.id,
					name: rule.name,
					description: rule.description,
					enabled: rule.enabled,
					trigger: rule.trigger,
					triggerConfig: rule.triggerConfig,
					conditions: rule.conditions,
					actions: rule.actions,
					runCount: rule.runCount,
					lastRunAt: rule.lastRunAt,
					lastError: rule.lastError
				}
			: null,
		options: editorOptions(access.project.id),
		projectId: access.project.id,
		archived: access.archived
	};
};

function parseRule(form: FormData) {
	try {
		return JSON.parse(String(form.get('rule') ?? '{}'));
	} catch {
		return {};
	}
}

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const input = parseRule(await request.formData());
		let id: number;
		try {
			if (params.id === 'new') id = createRule(user.id, access, input, locals.clientIp).id;
			else {
				id = intParam(params.id) ?? 0;
				updateRule(user.id, access, id, input, locals.clientIp);
			}
		} catch (err) {
			return handleServiceError(err);
		}
		if (params.id === 'new')
			redirect(303, projectPath(access.project.key, `settings/automations/${id}?saved=1`));
		return { saved: true };
	},
	test: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'staff');
		const form = await request.formData();
		const number = parseTicketReference(String(form.get('ticket') ?? ''), access.project.key);
		const ticket = number ? getTicket(access.project.id, number) : undefined;
		if (!ticket) return fail(400, { errors: { ticket: 'Choose a ticket of this project' } });
		try {
			const rule = normaliseRule(parseRule(form), access.project.id);
			const result = testRule(
				access.project,
				{ id: intParam(params.id) ?? 0, createdById: user.id, ...rule },
				ticket
			);
			return { test: result };
		} catch (err) {
			if (err instanceof ServiceError) return fail(400, { errors: { test: err.message } });
			throw err;
		}
	}
};
