import { PRIORITY_META, STATUS_META, TYPE_META, type TicketPriority, type TicketStatus, type TicketType } from './constants';

/** Short, past-tense description of a ticket activity entry (actor name is prepended by the UI). */
export function describeActivity(type: string, data: Record<string, unknown>): string {
	switch (type) {
		case 'created':
			return `reported this ${data.type ? TYPE_META[data.type as TicketType]?.short.toLowerCase() : 'ticket'}`;
		case 'status': {
			const to = data.to as TicketStatus;
			const from = data.from as TicketStatus;
			if (data.effect === 'completed') return 'marked this as completed';
			if (data.effect === 'reopened') return `reopened this (${STATUS_META[to]?.label})`;
			if (to === 'duplicate') return 'marked this as a duplicate';
			return `changed the status from ${STATUS_META[from]?.label} to ${STATUS_META[to]?.label}`;
		}
		case 'priority':
			return `changed the priority to ${PRIORITY_META[data.to as TicketPriority]?.label ?? data.to}`;
		case 'assigned':
			return `assigned this to ${data.assigneeName ?? 'someone'}`;
		case 'unassigned':
			return 'removed the assignee';
		case 'edited': {
			const fields = (data.fields as string[] | undefined) ?? [];
			return fields.length ? `edited the ${fields.join(', ')}` : 'edited the ticket';
		}
		case 'labels':
			return 'updated the labels';
		case 'duplicate_linked':
			return `linked a duplicate (#${data.number})`;
		case 'comment_removed':
			return 'removed a comment';
		case 'attachment_removed':
			return `removed an attachment (${data.name ?? 'image'})`;
		default:
			return 'updated the ticket';
	}
}
