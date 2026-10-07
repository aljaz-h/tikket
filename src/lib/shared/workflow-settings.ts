import {
	DEFAULT_WORKFLOW,
	STATUS_META,
	TICKET_STATUSES,
	type TicketStatus,
	type WorkflowSettings
} from './constants';

/**
 * Pure workflow rules, shared by the server (enforcement) and the browser (the settings page
 * validates as you edit; the ticket page offers only allowed transitions).
 */

export function workflowFor(project: {
	workflowSettings: WorkflowSettings | null;
}): WorkflowSettings {
	return { ...DEFAULT_WORKFLOW, ...(project.workflowSettings ?? {}) };
}

const unresolved = (s: TicketStatus) => !STATUS_META[s].resolved;

/** Problems that make a configuration unusable (empty list = valid). */
export function validateWorkflow(w: WorkflowSettings): string[] {
	const errors: string[] = [];
	const enabled = new Set(w.enabled);
	if (![...enabled].some(unresolved))
		errors.push('Enable at least one open status (Open, Planned, In Progress or On Hold).');
	if (!enabled.has(w.defaultStatus)) errors.push('The default status must be enabled.');
	else if (!unresolved(w.defaultStatus))
		errors.push('New tickets must start in an open status (not completed, declined or duplicate).');
	if (w.transitions) {
		for (const [from, targets] of Object.entries(w.transitions) as [
			TicketStatus,
			TicketStatus[]
		][]) {
			if (targets.includes(from))
				errors.push(`${STATUS_META[from].label} cannot transition to itself.`);
			if (targets.some((t) => !enabled.has(t)))
				errors.push(`Transitions from ${STATUS_META[from].label} lead to a disabled status.`);
		}
		// Every resolved status must lead back to something, or tickets could never be reopened.
		const reachable = new Set<TicketStatus>([w.defaultStatus]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const s of [...reachable])
				for (const t of w.transitions[s] ?? [])
					if (!reachable.has(t)) {
						reachable.add(t);
						grew = true;
					}
		}
		if (![...reachable].some((s) => STATUS_META[s].resolved))
			errors.push(
				'With these transitions no ticket can ever be resolved. Allow a path to Completed, Declined or Duplicate.'
			);
	}
	return [...new Set(errors)];
}

/** Statuses a ticket in `from` may move to (enabled and allowed), in display order. */
export function allowedTargets(w: WorkflowSettings, from: TicketStatus): TicketStatus[] {
	const enabled = TICKET_STATUSES.filter((s) => w.enabled.includes(s) && s !== from);
	if (!w.transitions) return enabled;
	const allowed = w.transitions[from];
	// A status without configured transitions (e.g. one enabled later) may go anywhere enabled.
	return allowed ? enabled.filter((s) => allowed.includes(s)) : enabled;
}

/** Returns an error message if the change is not allowed by the project's workflow. */
export function checkTransition(
	w: WorkflowSettings,
	from: TicketStatus,
	to: TicketStatus,
	note: string | null | undefined
): string | null {
	if (from === to) return null;
	if (!w.enabled.includes(to)) return `${STATUS_META[to].label} is disabled in this project.`;
	if (!allowedTargets(w, from).includes(to))
		return `Tickets cannot move from ${STATUS_META[from].label} to ${STATUS_META[to].label} in this project.`;
	if (w.requireNote.includes(to) && !note?.trim())
		return `A note is required when changing the status to ${STATUS_META[to].label}.`;
	return null;
}
