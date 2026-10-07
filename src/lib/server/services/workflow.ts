import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TICKET_PRIORITIES, TICKET_STATUSES, type WorkflowSettings } from '../../shared/constants';
import type { ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import { audit } from './audit';
import { ServiceError } from './users';
import { validateWorkflow, workflowFor } from '../../shared/workflow-settings';

export {
	allowedTargets,
	checkTransition,
	validateWorkflow,
	workflowFor
} from '../../shared/workflow-settings';

/**
 * Per-project workflow: a limited configuration of the built-in (system) statuses – which are
 * enabled, the defaults for new tickets, allowed transitions and transitions that need a note.
 * Statuses themselves are fixed; disabling one never changes existing tickets or history.
 */

const status = z.enum(TICKET_STATUSES);
export const workflowSchema = z.object({
	enabled: z.array(status).min(1),
	defaultStatus: status,
	defaultPriority: z.enum(TICKET_PRIORITIES),
	transitions: z.partialRecord(status, z.array(status)).nullable(),
	reporterCanReopen: z.boolean(),
	commentsOnCompleted: z.boolean(),
	requireNote: z.array(status)
});

export function saveWorkflow(
	actorId: number,
	access: ProjectAccess,
	input: WorkflowSettings,
	ip: string | null
) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can change the workflow', 'form', 403);
	const parsed = workflowSchema.safeParse(input);
	if (!parsed.success) throw new ServiceError('The workflow settings are invalid', 'form');
	const next: WorkflowSettings = {
		...parsed.data,
		enabled: TICKET_STATUSES.filter((s) => parsed.data.enabled.includes(s)),
		requireNote: TICKET_STATUSES.filter((s) => parsed.data.requireNote.includes(s)),
		transitions: parsed.data.transitions
			? (Object.fromEntries(
					TICKET_STATUSES.map((s) => [
						s,
						TICKET_STATUSES.filter((t) => parsed.data.transitions![s]?.includes(t))
					])
				) as WorkflowSettings['transitions'])
			: null
	};
	const errors = validateWorkflow(next);
	if (errors.length) throw new ServiceError(errors[0], 'form');
	const previous = workflowFor(access.project);
	getDb()
		.update(schema.projects)
		.set({ workflowSettings: next, updatedAt: new Date() })
		.where(eq(schema.projects.id, access.project.id))
		.run();
	audit({
		actorId,
		action: 'project.workflow',
		targetType: 'project',
		targetId: access.project.id,
		data: { from: previous, to: next },
		ip
	});
	return next;
}
