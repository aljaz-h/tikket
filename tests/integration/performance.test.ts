import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getInstance, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import { createTicket } from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { queryTickets, boardTickets } from '../../src/lib/server/services/search';
import { parseTicketFilters } from '../../src/lib/shared/filters';
import { listNotifications } from '../../src/lib/server/services/notifications';
import { staffDashboard, userDashboard } from '../../src/lib/server/services/dashboard';
import { listQueueJobs } from '../../src/lib/server/outbound/admin';
import { listRuns } from '../../src/lib/server/automations/rules';

/** Counts SQL statements prepared while `fn` runs (drizzle prepares one per query). */
function countQueries(fn: () => unknown) {
	const sqlite = getInstance().sqlite;
	const original = sqlite.prepare.bind(sqlite);
	let n = 0;
	sqlite.prepare = ((source: string) => {
		n++;
		return original(source);
	}) as typeof sqlite.prepare;
	try {
		fn();
	} finally {
		sqlite.prepare = original;
	}
	return n;
}

let owner: User, member: User, project: Project;
const fresh = () => findProjectById(project.id)!;
function addTickets(n: number) {
	for (let i = 0; i < n; i++) {
		const t = createTicket(member, access(member, fresh()), {
			type: 'bug',
			title: `Ticket ${i}`,
			descriptionHtml: '<p>x</p>',
			descriptionText: 'x',
			context: {}
		});
		addComment(owner, access(owner, fresh()), t, { html: '<p>hi</p>', text: 'hi' });
	}
}

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	member = await makeUser();
	project = makeProject(owner, { key: 'PRF' });
	join(owner, project, member);
});

describe('query counts do not grow with the data (no N+1)', () => {
	it('ticket list, board, notifications, dashboards, queue and automation history', () => {
		const run = () => ({
			list: countQueries(() =>
				queryTickets({
					scope: eq(schema.tickets.projectId, project.id),
					filters: parseTicketFilters(new URLSearchParams()),
					pageSize: 50,
					projectKey: 'PRF',
					staff: true
				})
			),
			board: countQueries(() =>
				boardTickets({
					scope: eq(schema.tickets.projectId, project.id),
					filters: parseTicketFilters(new URLSearchParams()),
					pageSize: 50,
					projectKey: 'PRF',
					staff: true
				})
			),
			notifications: countQueries(() => listNotifications(member.id, { limit: 50 })),
			dashboard: countQueries(() => userDashboard(member)),
			staff: countQueries(() => staffDashboard(owner, [project.id])),
			queue: countQueries(() => listQueueJobs({ filter: 'pending' })),
			runs: countQueries(() => listRuns(project.id))
		});
		addTickets(3);
		const small = run();
		addTickets(30);
		const large = run();
		expect(large).toEqual(small);
	});

	it('ticket lists are paginated', () => {
		addTickets(30);
		const page = queryTickets({
			scope: eq(schema.tickets.projectId, project.id),
			filters: parseTicketFilters(new URLSearchParams()),
			pageSize: 10,
			projectKey: 'PRF',
			staff: true
		});
		expect(page.rows.length).toBe(10);
		expect(page.total).toBe(30);
	});
});
