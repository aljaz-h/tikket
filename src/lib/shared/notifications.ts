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
	const base = describeOne(n);
	// Grouped notifications (same ticket and kind while still unread) show how many there were.
	const count = Number(n.data.groupCount ?? 1);
	return count > 1 ? `${base} (${count} updates)` : base;
}

function describeOne(n: NotificationLike): string {
	const d = n.data;
	const who =
		n.actorName ??
		(d.automation === 'github'
			? 'GitHub automation'
			: d.automation
				? `Automation “${d.automation}”`
				: 'Someone');
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
			if (d.kind === 'automation')
				return d.message ? `${who}: ${d.message}` : `${who} flagged this ticket for you`;
			if (d.kind === 'priority' && TICKET_PRIORITIES.includes(d.to as TicketPriority))
				return `${who} set the priority to ${PRIORITY_META[d.to as TicketPriority].label}`;
			return `${who} updated the ticket`;
		}
		case 'release':
			return `${who} published release ${d.version ?? ''}`.trim();
		case 'milestone': {
			if (d.kind === 'completed') return `${who} completed the milestone “${d.milestone}”`;
			if (Number(d.bulkCount) > 1)
				return d.milestone
					? `${who} moved ${d.bulkCount} tickets to the milestone “${d.milestone}”`
					: `${who} removed ${d.bulkCount} tickets from their milestone`;
			return d.milestone
				? `${who} moved this to the milestone “${d.milestone}”`
				: `${who} removed this from its milestone`;
		}
		default:
			return `${who} updated a ticket`;
	}
}
