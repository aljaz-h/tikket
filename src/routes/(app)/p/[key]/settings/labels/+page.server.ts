import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { createLabel, deleteLabel, listLabels, updateLabel } from '$lib/server/services/projects';
import { parseForm } from '$lib/server/validation';
import { LABEL_COLORS } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Labels · Settings · ${access.project.name}`,
		labels: listLabels(access.project.id)
	};
};

function owner(locals: App.Locals, key: string) {
	const user = requireActionUser(locals);
	return { user, access: requireProject(user, key, 'owner') };
}

const labelSchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(40),
	color: z.enum(LABEL_COLORS)
});

export const actions: Actions = {
	createLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const parsed = parseForm(labelSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			createLabel(access.project.id, parsed.data.name, parsed.data.color);
		} catch (err) {
			return handleServiceError(err);
		}
		return { labelCreated: true };
	},

	updateLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const form = await request.formData();
		const id = intParam(String(form.get('labelId')));
		const parsed = parseForm(labelSchema, form);
		if (!parsed.ok) return parsed.failure;
		if (!id) error(404, 'Label not found');
		try {
			if (!updateLabel(access.project.id, id, parsed.data.name, parsed.data.color))
				error(404, 'Label not found');
		} catch (err) {
			return handleServiceError(err);
		}
		return { labelUpdated: true };
	},

	deleteLabel: async ({ locals, params, request }) => {
		const { access } = owner(locals, params.key);
		const id = intParam(String((await request.formData()).get('labelId')));
		if (!id || !deleteLabel(access.project.id, id)) error(404, 'Label not found');
		return { labelDeleted: true };
	}
};
