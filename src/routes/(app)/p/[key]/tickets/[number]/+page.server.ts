import { error, fail } from '@sveltejs/kit';
import {
	canDeleteComment,
	canEditComment,
	canEditTicket,
	canViewInternalNotes,
	canWriteInternalNotes
} from '$lib/server/authz';
import { getTemplateResponse } from '$lib/server/services/templates';
import {
	addRelationship,
	listRelationships,
	removeRelationship
} from '$lib/server/services/relationships';
import { RELATION_CHOICES, type RelationChoice } from '$lib/shared/constants';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { normaliseRichInput } from '$lib/server/sanitize';
import { addComment, deleteComment, editComment, getComment } from '$lib/server/services/comments';
import { markTicketRead } from '$lib/server/services/notifications';
import { listAssignableUsers, listLabels } from '$lib/server/services/projects';
import {
	assignTicket,
	changePriority,
	changeStatus,
	getTicketDetail,
	recentVoters,
	removeTicketAttachment,
	setFollow,
	setTicketLabels,
	setVote
} from '$lib/server/services/tickets';
import { requireTicket } from '$lib/server/ticket-context';
import { checkWriteLimit, pendingPreview } from '$lib/server/ticket-form';
import { storeImage } from '$lib/server/uploads';
import { commentSchema, parseForm, prioritySchema, statusSchema } from '$lib/server/validation';
import { ticketRef } from '$lib/shared/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { access, ticket } = requireTicket(locals.user, params.key, params.number);
	const user = locals.user;
	const detail = getTicketDetail(user, ticket, { internal: canViewInternalNotes(access) });
	if (user) markTicketRead(user.id, ticket.id);
	const ref = ticketRef(access.project.key, ticket.number);
	return {
		title: `${ref} ${ticket.title}`,
		created: url.searchParams.has('created'),
		ticket: {
			id: ticket.id,
			number: ticket.number,
			ref,
			type: ticket.type,
			title: ticket.title,
			descriptionHtml: ticket.descriptionHtml,
			context: ticket.context,
			source: ticket.source,
			environment: access.isStaff ? ticket.environment : null,
			status: ticket.status,
			priority: ticket.priority,
			resolutionNote: ticket.resolutionNote,
			voteCount: ticket.voteCount,
			createdAt: ticket.createdAt,
			updatedAt: ticket.updatedAt,
			completedAt: ticket.completedAt,
			assigneeId: ticket.assigneeId
		},
		detail: {
			...detail,
			comments: detail.comments.map((c) => ({
				...c,
				canEdit: canEditComment(access, user, {
					...c,
					ticketId: ticket.id,
					bodyText: '',
					updatedAt: c.createdAt,
					deletedById: null
				}),
				canDelete: canDeleteComment(access, user, {
					...c,
					ticketId: ticket.id,
					bodyText: '',
					updatedAt: c.createdAt,
					deletedById: null
				})
			}))
		},
		templateResponse: getTemplateResponse(ticket.id),
		relationships: listRelationships(ticket.id),
		canWriteInternal: canWriteInternalNotes(access),
		voters: access.project.votingEnabled ? recentVoters(ticket.id) : [],
		canEdit: canEditTicket(access, user, ticket),
		assignable: access.isStaff ? listAssignableUsers(access.project.id) : [],
		labels: access.isStaff ? listLabels(access.project.id) : []
	};
};

function commentBody(form: FormData) {
	const parsed = parseForm(commentSchema, form);
	if (!parsed.ok) return parsed;
	return { ok: true as const, data: normaliseRichInput(parsed.data.body, parsed.data.bodyFormat) };
}

export const actions: Actions = {
	comment: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		// Permission depends on the kind of comment (public reply vs internal note); addComment checks.
		const { access, ticket } = requireTicket(user, params.key, params.number, 'view');
		const form = await request.formData();
		const body = commentBody(form);
		if (!body.ok) return body.failure;
		const ids = form.getAll('attachmentIds').map(String);
		const internal = form.get('internal') === '1';
		try {
			checkWriteLimit(user.id);
			for (const file of form.getAll('files')) {
				if (file instanceof File && file.size > 0) {
					if (!access.canAttach)
						return fail(400, { errors: { attachments: 'Attachments are disabled' }, values: {} });
					ids.push((await storeImage(file, { uploaderId: user.id })).id);
				}
			}
			const comment = addComment(user, access, ticket, body.data, ids, { internal });
			return { commented: comment.id };
		} catch (err) {
			const result = handleServiceError(err, { body: String(form.get('body') ?? '') });
			return fail(result.status, { ...result.data, attachments: pendingPreview(user.id, ids) });
		}
	},

	editComment: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number);
		const form = await request.formData();
		const comment = getComment(ticket.id, intParam(String(form.get('commentId'))) ?? 0);
		if (!comment) error(404, 'Comment not found');
		const body = commentBody(form);
		if (!body.ok) return body.failure;
		try {
			editComment(user, access, comment, body.data);
		} catch (err) {
			return handleServiceError(err);
		}
		return { edited: comment.id };
	},

	deleteComment: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number);
		const form = await request.formData();
		const comment = getComment(ticket.id, intParam(String(form.get('commentId'))) ?? 0);
		if (!comment) error(404, 'Comment not found');
		try {
			deleteComment(user, access, comment);
		} catch (err) {
			return handleServiceError(err);
		}
		return { deleted: comment.id };
	},

	status: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const parsed = parseForm(statusSchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			changeStatus(user, access, ticket, parsed.data);
		} catch (err) {
			return handleServiceError(err);
		}
		return { status: parsed.data.status };
	},

	priority: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const parsed = parseForm(prioritySchema, await request.formData());
		if (!parsed.ok) return parsed.failure;
		try {
			changePriority(user, access, ticket, parsed.data.priority);
		} catch (err) {
			return handleServiceError(err);
		}
		return { priority: parsed.data.priority };
	},

	assign: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const raw = String((await request.formData()).get('assigneeId') ?? '');
		const assigneeId = raw === '' || raw === 'none' ? null : intParam(raw);
		if (raw && raw !== 'none' && assigneeId === null)
			return fail(400, { errors: { assignee: 'Invalid assignee' }, values: {} });
		try {
			assignTicket(user, access, ticket, assigneeId);
		} catch (err) {
			return handleServiceError(err);
		}
		return { assigned: assigneeId };
	},

	labels: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const ids = (await request.formData())
			.getAll('labelId')
			.map((v) => intParam(String(v)))
			.filter((v): v is number => v !== null);
		try {
			setTicketLabels(user, access, ticket, ids);
		} catch (err) {
			return handleServiceError(err);
		}
		return { labels: true };
	},

	vote: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'vote');
		const on = String((await request.formData()).get('on')) === '1';
		try {
			return { voteCount: setVote(user, access, ticket, on), voted: on };
		} catch (err) {
			return handleServiceError(err);
		}
	},

	follow: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { ticket } = requireTicket(user, params.key, params.number, 'view');
		const on = String((await request.formData()).get('on')) === '1';
		setFollow(user, ticket, on);
		return { following: on };
	},

	relate: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const form = await request.formData();
		const relation = String(form.get('relation') ?? '');
		const reference = String(form.get('ticket') ?? '').trim();
		if (!(relation in RELATION_CHOICES))
			return fail(400, { errors: { relation: 'Choose a relationship' }, values: { reference } });
		try {
			addRelationship(user, access, ticket, relation as RelationChoice, reference);
		} catch (err) {
			return handleServiceError(err, { reference });
		}
		return { related: true };
	},

	unrelate: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'staff');
		const id = intParam(String((await request.formData()).get('relationshipId') ?? ''));
		try {
			removeRelationship(user, access, ticket, id ?? 0);
		} catch (err) {
			return handleServiceError(err);
		}
		return { unrelated: true };
	},

	removeAttachment: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const { access, ticket } = requireTicket(user, params.key, params.number, 'view');
		const id = String((await request.formData()).get('attachmentId') ?? '');
		try {
			removeTicketAttachment(user, access, ticket, id);
		} catch (err) {
			return handleServiceError(err);
		}
		return { removed: id };
	}
};
