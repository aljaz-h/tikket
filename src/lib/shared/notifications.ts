import {
	STATUS_META,
	TICKET_PRIORITIES,
	PRIORITY_META,
	type NotificationType,
	type TicketStatus,
	type TicketPriority
} from './constants';

export interface NotificationLike {
	type: NotificationType;
	data: Record<string, unknown>;
	actorName: string | null;
	ticketTitle: string | null;
}

/** Human-readable one-line summary of a notification. */
export function describeNotification(n: NotificationLike): string {
	const who = n.actorName ?? 'Someone';
	const d = n.data;
	switch (n.type) {
		case 'new_ticket':
			return `${who} submitted a new ticket`;
		case 'comment':
			return d.internal ? `${who} added an internal note` : `${who} commented`;
		case 'mention':
			return d.internal ? `${who} mentioned you in an internal note` : `${who} mentioned you`;
		case 'assigned':
			return Number(d.bulkCount) > 1
				? `${who} assigned ${d.bulkCount} tickets to you`
				: `${who} assigned this ticket to you`;
		case 'status': {
			const to = d.to as TicketStatus | undefined;
			if (Number(d.bulkCount) > 1)
				return `${who} changed the status of ${d.bulkCount} tickets to ${to ? STATUS_META[to].label : 'a new status'}`;
			if (to === 'completed') return `${who} marked this as completed`;
			if (to === 'declined') return `${who} declined this ticket`;
			if (to === 'duplicate') return `${who} marked this as a duplicate`;
			return `${who} changed the status to ${to ? STATUS_META[to].label : 'a new status'}`;
		}
		case 'update': {
			if (d.kind === 'priority' && TICKET_PRIORITIES.includes(d.to as TicketPriority))
				return `${who} set the priority to ${PRIORITY_META[d.to as TicketPriority].label}`;
			return `${who} updated the ticket`;
		}
		default:
			return `${who} updated a ticket`;
	}
}
