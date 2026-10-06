import { error } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { requireProject } from '$lib/server/authz';
import { getDb, schema } from '$lib/server/db';
import { intParam, requireActionUser } from '$lib/server/http';
import { deleteTemplate, listTemplates } from '$lib/server/services/templates';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Ticket templates · ${access.project.name}`,
		templates: listTemplates(access.project.id)
	};
};

function target(locals: App.Locals, key: string, form: FormData) {
	const user = requireActionUser(locals);
	const access = requireProject(user, key, 'owner');
	const id = intParam(String(form.get('templateId')));
	const tpl = id ? listTemplates(access.project.id).find((t) => t.id === id) : undefined;
	if (!tpl) error(404, 'Template not found');
	return { access, tpl };
}

export const actions: Actions = {
	toggle: async ({ locals, params, request }) => {
		const { tpl } = target(locals, params.key, await request.formData());
		const t = schema.ticketTemplates;
		getDb()
			.update(t)
			.set({
				enabled: !tpl.enabled,
				isDefault: tpl.enabled ? false : tpl.isDefault,
				updatedAt: new Date()
			})
			.where(eq(t.id, tpl.id))
			.run();
		return { toggled: true };
	},
	makeDefault: async ({ locals, params, request }) => {
		const { access, tpl } = target(locals, params.key, await request.formData());
		const t = schema.ticketTemplates;
		getDb().transaction((tx) => {
			tx.update(t)
				.set({ isDefault: false })
				.where(and(eq(t.projectId, access.project.id), eq(t.type, tpl.type), ne(t.id, tpl.id)))
				.run();
			tx.update(t).set({ isDefault: true, enabled: true }).where(eq(t.id, tpl.id)).run();
		});
		return { defaulted: true };
	},
	delete: async ({ locals, params, request }) => {
		const { access, tpl } = target(locals, params.key, await request.formData());
		deleteTemplate(access.project.id, tpl.id);
		return { deleted: true };
	}
};
