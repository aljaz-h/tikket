import {
	PRIORITY_META,
	RELATION_CHOICES,
	type RelationChoice,
	STATUS_META,
	TYPE_META,
	type TicketPriority,
	type TicketStatus,
	type TicketType
} from './constants';

/** Short, past-tense description of a ticket activity entry (actor name is prepended by the UI). */
export function describeActivity(type: string, data: Record<string, unknown>): string {
	switch (type) {
		case 'created':
			return `reported this ${data.type ? TYPE_META[data.type as TicketType]?.short.toLowerCase() : 'ticket'}`;
		case 'status': {
			const to = data.to as TicketStatus;
			const from = data.from as TicketStatus;
			const via = data.automation as { pr?: number } | undefined;
			if (via?.pr)
				return `${data.effect === 'completed' ? 'marked this as completed' : `moved this to ${STATUS_META[to]?.label}`} after pull request #${via.pr} was merged`;
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
		case 'duplicate_linked': {
			const votes = Number(data.votesAdded ?? 0);
			return `merged duplicate #${data.number} into this ticket${votes ? ` (+${votes} vote${votes === 1 ? '' : 's'})` : ''}`;
		}
		case 'relation_added':
			return `linked this ticket: ${RELATION_CHOICES[data.relation as RelationChoice]?.toLowerCase() ?? 'related to'} #${data.number}`;
		case 'relation_removed':
			return `removed the link: ${RELATION_CHOICES[data.relation as RelationChoice]?.toLowerCase() ?? 'related to'} #${data.number}`;
		case 'release':
			return data.to
				? data.from
					? `moved this from release ${data.from} to ${data.to}`
					: `added this to release ${data.to}`
				: `removed this from release ${data.from ?? ''}`.trim();
		case 'milestone':
			return data.to
				? data.from
					? `moved this from milestone “${data.from}” to “${data.to}”`
					: `added this to milestone “${data.to}”`
				: `removed this from milestone “${data.from ?? ''}”`;
		case 'bulk':
			return 'updated this ticket in a bulk edit';
		case 'comment_removed':
			return data.internal ? 'removed an internal note' : 'removed a comment';
		case 'attachment_removed':
			return `removed an attachment (${data.name ?? 'image'})`;
		default:
			return 'updated the ticket';
	}
}
