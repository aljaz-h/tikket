import { error } from '@sveltejs/kit';
import { requireProject, type Actor, type ProjectNeed } from './authz';
import { intParam } from './http';
import { getTicket } from './services/tickets';

/** Loads a ticket by project key and number, enforcing project access first. */
export function requireTicket(actor: Actor, key: string, numberParam: string, need: ProjectNeed = 'view') {
	const access = requireProject(actor, key, need);
	const number = intParam(numberParam);
	const ticket = number ? getTicket(access.project.id, number) : undefined;
	if (!ticket) error(404, 'Ticket not found');
	return { access, ticket };
}
