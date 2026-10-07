import { fail } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import {
	createFromTemplate,
	deleteRule,
	listRules,
	setRuleEnabled,
	TEMPLATES,
	type TemplateId
} from '$lib/server/automations/rules';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'staff');
	return {
		title: `Automations · ${access.project.name}`,
		rules: listRules(access.project.id).map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			enabled: r.enabled,
			trigger: r.trigger,
			actionCount: r.actions.length,
			conditionCount: r.conditions.any.reduce((n, g) => n + g.all.length, 0),
			runCount: r.runCount,
			lastRunAt: r.lastRunAt,
			lastError: r.lastError
		})),
		templates: TEMPLATES,
		archived: access.archived
	};
};

function staff(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'staff') };
}

export const actions: Actions = {
	toggle: async ({ locals, params, request }) => {
		const { user, access } = staff(locals, params.key);
		const form = await request.formData();
		const id = intParam(String(form.get('id') ?? ''));
		if (!id) return fail(400, { errors: { form: 'Unknown automation' } });
		try {
			setRuleEnabled(user.id, access, id, form.get('enabled') === 'true', locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { toggled: true };
	},
	delete: async ({ locals, params, request }) => {
		const { user, access } = staff(locals, params.key);
		const id = intParam(String((await request.formData()).get('id') ?? ''));
		if (!id) return fail(400, { errors: { form: 'Unknown automation' } });
		try {
			deleteRule(user.id, access, id, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { deleted: true };
	},
	template: async ({ locals, params, request }) => {
		const { user, access } = staff(locals, params.key);
		const id = String((await request.formData()).get('template') ?? '') as TemplateId;
		try {
			const rule = createFromTemplate(user.id, access, id, locals.clientIp);
			return { createdId: rule.id };
		} catch (err) {
			return handleServiceError(err);
		}
	}
};
