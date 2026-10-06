import { STATUS_META, type TicketStatus } from './constants';

export interface StatusChangeTicket {
	id: number;
	projectId: number;
	status: TicketStatus;
}

export interface DuplicateTarget {
	id: number;
	projectId: number;
	status: TicketStatus;
	duplicateOfId: number | null;
}

/**
 * Validates a status change. Every status may move to any other status (a deliberately simple
 * workflow); Duplicate additionally requires a valid target ticket in the same project.
 * Returns an error message, or null when the change is allowed.
 */
export function validateStatusChange(
	ticket: StatusChangeTicket,
	to: TicketStatus,
	target?: DuplicateTarget | null
): string | null {
	if (!(to in STATUS_META)) return 'Unknown status';
	if (to === 'duplicate') {
		if (!target) return 'Enter the ticket this one duplicates';
		if (target.projectId !== ticket.projectId) return 'The original ticket must be in the same project';
		if (target.id === ticket.id) return 'A ticket cannot duplicate itself';
		if (target.status === 'duplicate' || target.duplicateOfId === ticket.id)
			return 'The original ticket is itself marked as a duplicate';
		return null;
	}
	if (to === ticket.status) return 'The ticket already has this status';
	return null;
}

export type StatusEffect = 'completed' | 'reopened' | 'closed' | 'changed';

/** Describes what a transition means, for activity history and timestamps. */
export function statusEffect(from: TicketStatus, to: TicketStatus): StatusEffect {
	if (to === 'completed') return 'completed';
	if (STATUS_META[from].resolved && !STATUS_META[to].resolved) return 'reopened';
	if (STATUS_META[to].resolved) return 'closed';
	return 'changed';
}

/** Parses "SPL-12", "#12" or "12" into a ticket number for the given project key. */
export function parseTicketReference(value: string, projectKey: string): number | null {
	const trimmed = value.trim().toUpperCase();
	const match = /^(?:([A-Z][A-Z0-9]*)-|#)?(\d{1,9})$/.exec(trimmed);
	if (!match) return null;
	if (match[1] && match[1] !== projectKey.toUpperCase()) return null;
	return Number(match[2]);
}
