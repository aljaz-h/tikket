import { and, eq, inArray, sql } from 'drizzle-orm';
import { extractMentions } from '../../shared/text';
import {
	canDeleteComment,
	canEditComment,
	canWriteInternalNotes,
	type Actor,
	type ProjectAccess
} from '../authz';
import { getDb, schema } from '../db';
import type { Ticket, TicketComment } from '../db/schema';
import { getSettings } from '../settings';
import { pendingAttachmentsFor } from '../uploads';
import { followerIds, notify } from './notifications';
import { addActivity } from './tickets';
import { ServiceError } from './users';

type ActiveActor = NonNullable<Actor>;

export function getComment(ticketId: number, commentId: number): TicketComment | undefined {
	return getDb()
		.select()
		.from(schema.ticketComments)
		.where(
			and(eq(schema.ticketComments.id, commentId), eq(schema.ticketComments.ticketId, ticketId))
		)
		.get();
}

export function isInternalComment(commentId: number): boolean {
	return !!getDb()
		.select({ internal: schema.ticketComments.internal })
		.from(schema.ticketComments)
		.where(eq(schema.ticketComments.id, commentId))
		.get()?.internal;
}

/** Resolves @mentions to active users (access is re-checked when notifying). */
function mentionedUserIds(text: string): number[] {
	const names = extractMentions(text);
	if (!names.length) return [];
	return getDb()
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(
			and(inArray(sql`lower(${schema.users.username})`, names), eq(schema.users.status, 'active'))
		)
		.all()
		.map((r) => r.id);
}

export function addComment(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	body: { html: string; text: string },
	attachmentIds: string[] = [],
	opts: { internal?: boolean } = {}
): TicketComment {
	const internal = !!opts.internal;
	if (internal && !canWriteInternalNotes(access))
		throw new ServiceError('Only project staff can write internal notes', 'body', 403);
	if (!internal && !access.canComment)
		throw new ServiceError('Comments are not available on this ticket', 'body', 403);
	if (attachmentIds.length && !access.canAttach)
		throw new ServiceError('Attachments are disabled for this project', 'attachments');
	const pending = pendingAttachmentsFor(actor.id, attachmentIds);
	const max = getSettings().maxAttachmentsPerTicket;
	if (pending.length > max)
		throw new ServiceError(`You can attach up to ${max} images per comment`, 'attachments');
	if (!body.text.trim() && !pending.length)
		throw new ServiceError('Write a comment or attach an image', 'body');

	const db = getDb();
	return db.transaction(
		(tx) => {
			const comment = tx
				.insert(schema.ticketComments)
				.values({
					ticketId: ticket.id,
					authorId: actor.id,
					bodyHtml: body.html,
					bodyText: body.text,
					internal
				})
				.returning()
				.get();
			if (pending.length)
				tx.update(schema.attachments)
					.set({
						projectId: ticket.projectId,
						ticketId: ticket.id,
						commentId: comment.id,
						kind: 'comment',
						attachedAt: new Date()
					})
					.where(
						inArray(
							schema.attachments.id,
							pending.map((p) => p.id)
						)
					)
					.run();
			// Internal notes leave no public trace: no comment count, no "updated" timestamp.
			if (!internal)
				tx.update(schema.tickets)
					.set({ commentCount: sql`${schema.tickets.commentCount} + 1`, updatedAt: new Date() })
					.where(eq(schema.tickets.id, ticket.id))
					.run();
			const recipients = new Set([...followerIds(ticket.id, tx), ticket.reporterId]);
			tx.insert(schema.ticketFollowers)
				.values({ ticketId: ticket.id, userId: actor.id })
				.onConflictDoNothing()
				.run();

			// Internal notes: staff recipients only, and no content in the notification itself.
			const excerpt = internal ? undefined : body.text.slice(0, 160);
			const data = internal
				? { commentId: comment.id, internal: true }
				: { commentId: comment.id, excerpt };
			const mentioned = mentionedUserIds(body.text).filter((id) => id !== actor.id);
			notify(
				mentioned,
				{
					type: 'mention',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data,
					staffOnly: internal
				},
				tx
			);
			notify(
				[...recipients].filter((id) => !mentioned.includes(id)),
				{
					type: 'comment',
					project: access.project,
					ticketId: ticket.id,
					actorId: actor.id,
					data,
					staffOnly: internal
				},
				tx
			);
			return comment;
		},
		{ behavior: 'immediate' }
	);
}

export function editComment(
	actor: ActiveActor,
	access: ProjectAccess,
	comment: TicketComment,
	body: { html: string; text: string }
) {
	if (!canEditComment(access, actor, comment))
		throw new ServiceError('You cannot edit this comment', 'body', 403);
	if (!body.text.trim()) throw new ServiceError('A comment cannot be empty', 'body');
	if (body.html === comment.bodyHtml) return;
	getDb()
		.update(schema.ticketComments)
		.set({ bodyHtml: body.html, bodyText: body.text, editedAt: new Date(), updatedAt: new Date() })
		.where(eq(schema.ticketComments.id, comment.id))
		.run();
}

/** Soft-deletes a comment (own comment, or moderator removal). */
export function deleteComment(actor: ActiveActor, access: ProjectAccess, comment: TicketComment) {
	if (!canDeleteComment(access, actor, comment))
		throw new ServiceError('You cannot delete this comment', 'form', 403);
	const moderated = comment.authorId !== actor.id;
	getDb().transaction((tx) => {
		tx.update(schema.ticketComments)
			.set({ deletedAt: new Date(), deletedById: actor.id, bodyHtml: '', bodyText: '' })
			.where(eq(schema.ticketComments.id, comment.id))
			.run();
		tx.update(schema.attachments)
			.set({ deletedAt: new Date() })
			.where(eq(schema.attachments.commentId, comment.id))
			.run();
		if (!comment.internal)
			tx.update(schema.tickets)
				.set({ commentCount: sql`max(${schema.tickets.commentCount} - 1, 0)` })
				.where(eq(schema.tickets.id, comment.ticketId))
				.run();
		if (moderated)
			addActivity(tx, comment.ticketId, actor.id, 'comment_removed', {
				commentId: comment.id,
				internal: comment.internal || undefined
			});
	});
}
