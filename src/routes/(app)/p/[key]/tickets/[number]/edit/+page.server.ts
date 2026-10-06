import { error, fail, redirect } from '@sveltejs/kit';
import { canEditTicket } from '$lib/server/authz';
import { handleServiceError, requireActionUser, requireUser } from '$lib/server/http';
import { getTicketDetail, ticketAttachmentCount, updateTicketContent } from '$lib/server/services/tickets';
import { requireTicket } from '$lib/server/ticket-context';
import { checkWriteLimit, parseTicketForm, ticketFormValues } from '$lib/server/ticket-form';
import { getSettings } from '$lib/server/settings';
import { ticketPath, ticketRef } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = requireUser(locals, url);
	const { access, ticket } = requireTicket(user, params.key, params.number);
	if (!canEditTicket(access, user, ticket)) error(403, 'You cannot edit this ticket');
	return {
		title: `Edit ${ticketRef(access.project.key, ticket.number)}`,
		ticket: {
			number: ticket.number,
			ref: ticketRef(access.project.key, ticket.number),
			type: ticket.type,
			title: ticket.title,
			descriptionHtml: ticket.descriptionHtml,
			context: ticket.context
		},
		attachments: getTicketDetail(user, ticket).attachments,
		remainingAttachments: Math.max(0, getSettings().maxAttachmentsPerTicket - ticketAttachmentCount(ticket.id))
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number);
		if (!canEditTicket(access, user, ticket)) error(403, 'You cannot edit this ticket');
		const form = await request.formData();
		const values = ticketFormValues(form);
		try {
			checkWriteLimit(user.id);
			const parsed = await parseTicketForm(form, user.id, { allowFiles: access.canAttach });
			if (!parsed.ok) return fail(400, { errors: parsed.errors, values });
			updateTicketContent(user, access, ticket, parsed.data.input, parsed.data.attachmentIds);
		} catch (err) {
			return handleServiceError(err, values);
		}
		redirect(303, ticketPath(access.project.key, ticket.number));
	}
};
