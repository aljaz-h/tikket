import { beforeEach, describe, expect, it } from 'vitest';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import { createMilestone, setTicketMilestone } from '../../src/lib/server/services/milestones';
import { createTicket, getTicket } from '../../src/lib/server/services/tickets';
import { pickableTickets } from '../../src/lib/server/services/ticket-picker';
import { actions } from '../../src/routes/(app)/p/[key]/milestones/[id]/+page.server';

let owner: User, member: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: title,
	context: {}
});

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	member = await makeUser();
	project = makeProject(owner, { key: 'PCK' });
	join(owner, project, member, 'member');
	for (const title of ['One', 'Two', 'Three'])
		createTicket(member, access(member, fresh()), input(title));
});

describe('milestone ticket picker', () => {
	it('lists tickets that are not already in the milestone and names where others are', () => {
		const a = createMilestone(owner, access(owner, fresh()), {
			name: 'A',
			description: null,
			targetDate: null
		});
		const b = createMilestone(owner, access(owner, fresh()), {
			name: 'B',
			description: null,
			targetDate: null
		});
		setTicketMilestone(owner, access(owner, fresh()), getTicket(project.id, 1)!, a.id);
		setTicketMilestone(owner, access(owner, fresh()), getTicket(project.id, 2)!, b.id);
		const list = pickableTickets(project.id, { kind: 'milestone', id: a.id });
		expect(list.map((t) => t.number).sort()).toEqual([2, 3]);
		expect(list.find((t) => t.number === 2)!.elsewhere).toBe('B');
		expect(list.find((t) => t.number === 3)!.elsewhere).toBeNull();
	});

	it('adds several ticked tickets at once and only for staff', async () => {
		const ms = createMilestone(owner, access(owner, fresh()), {
			name: 'M',
			description: null,
			targetDate: null
		});
		const call = (user: User, numbers: number[]) => {
			const body = new FormData();
			for (const n of numbers) body.append('tickets', String(n));
			return (actions.addTickets as (e: never) => Promise<unknown>)({
				locals: { user, clientIp: null },
				params: { key: 'PCK', id: String(ms.id) },
				request: new Request('http://x/', { method: 'POST', body })
			} as never);
		};
		await expect(call(member, [1])).rejects.toMatchObject({ status: 403 });
		expect(await call(owner, [1, 3])).toEqual({ added: 2 });
		expect(getTicket(project.id, 1)!.milestoneId).toBe(ms.id);
		expect(getTicket(project.id, 3)!.milestoneId).toBe(ms.id);
		expect(getTicket(project.id, 2)!.milestoneId).toBeNull();
		expect(
			pickableTickets(project.id, { kind: 'milestone', id: ms.id }).map((t) => t.number)
		).toEqual([2]);
		expect(await call(owner, [])).toMatchObject({ status: 400 });
		expect(await call(owner, [99])).toMatchObject({ status: 400 });
	});
});

describe('people picker', () => {
	it('lists active non-members (no emails) and adds several at once, owners only', async () => {
		const { addableUsers, listMembers } = await import('../../src/lib/server/services/projects');
		const { actions: memberActions } =
			await import('../../src/routes/(app)/p/[key]/settings/members/+page.server');
		const a = await makeUser();
		const b = await makeUser();
		const list = addableUsers(project.id);
		expect(list.map((u) => u.id).sort()).toEqual([a.id, b.id].sort());
		expect(Object.keys(list[0]).sort()).toEqual(['avatarId', 'displayName', 'id', 'username']);
		const call = (user: User, ids: number[], role = 'moderator') => {
			const body = new FormData();
			for (const id of ids) body.append('userIds', String(id));
			body.set('role', role);
			return (memberActions.addMembers as (e: never) => Promise<unknown>)({
				locals: { user, clientIp: null },
				params: { key: 'PCK' },
				request: new Request('http://x/', { method: 'POST', body })
			} as never);
		};
		await expect(call(member, [a.id])).rejects.toMatchObject({ status: 403 });
		expect(await call(owner, [a.id, b.id])).toEqual({ membersAdded: 2 });
		expect(listMembers(project.id).filter((m) => m.role === 'moderator')).toHaveLength(2);
		expect(addableUsers(project.id)).toEqual([]);
		expect(await call(owner, [])).toMatchObject({ status: 400 });
		expect(await call(owner, [a.id])).toMatchObject({ status: 400 }); // already a member
	});
});
