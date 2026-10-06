import { fail, redirect } from '@sveltejs/kit';
import { accessForProject, findProjectByKey, assertAccess } from '$lib/server/authz';
import { handleServiceError, requireActionUser, requireUser } from '$lib/server/http';
import { listProjects } from '$lib/server/services/projects';
import { createTicket } from '$lib/server/services/tickets';
import { checkWriteLimit, parseTicketForm, pendingPreview, ticketFormValues } from '$lib/server/ticket-form';
import { UploadError } from '$lib/server/uploads';
import { TICKET_TYPES, type TicketType } from '$lib/shared/constants';
import { ticketPath } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals, url);
	const projects = listProjects(user)
		.map((p) => {
			const project = findProjectByKey(p.key)!;
			const access = accessForProject(user, project);
			return { key: p.key, name: p.name, icon: p.icon, color: p.color, description: p.description, canSubmit: access.canSubmit, canAttach: access.canAttach };
		})
		.filter((p) => p.canSubmit);
	const requested = url.searchParams.get('project')?.toUpperCase() ?? '';
	const type = url.searchParams.get('type');
	return {
		title: 'New ticket',
		projects,
		preselected: projects.some((p) => p.key === requested) ? requested : projects.length === 1 ? projects[0].key : '',
		initialType: TICKET_TYPES.includes(type as TicketType) ? (type as TicketType) : null
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const user = requireActionUser(locals);
		const form = await request.formData();
		const values = ticketFormValues(form);
		const key = String(form.get('project') ?? '');
		const project = key ? findProjectByKey(key) : undefined;
		if (!project) return fail(400, { errors: { project: 'Choose a project' }, values, attachments: pendingPreview(user.id, form.getAll('attachmentIds').map(String)) });
		const access = accessForProject(user, project);
		assertAccess(access, 'submit', user);

		try {
			checkWriteLimit(user.id);
			const parsed = await parseTicketForm(form, user.id, { allowFiles: access.canAttach });
			if (!parsed.ok)
				return fail(400, { errors: parsed.errors, values, attachments: pendingPreview(user.id, form.getAll('attachmentIds').map(String)) });
			const ticket = createTicket(user, access, parsed.data.input, parsed.data.attachmentIds);
			redirect(303, `${ticketPath(project.key, ticket.number)}?created=1`);
		} catch (err) {
			if (err instanceof UploadError)
				return fail(400, { errors: { attachments: err.message }, values, attachments: pendingPreview(user.id, form.getAll('attachmentIds').map(String)) });
			const result = handleServiceError(err, values);
			return fail(result.status, { ...result.data, attachments: pendingPreview(user.id, form.getAll('attachmentIds').map(String)) });
		}
	}
};
