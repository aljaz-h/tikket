import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import { createTicket } from '../../src/lib/server/services/tickets';
import { removeMember } from '../../src/lib/server/services/projects';
import {
	MAX_ACTIVE_REMINDERS,
	cancelReminder,
	createReminder,
	presetTime,
	processDueReminders,
	ticketReminders
} from '../../src/lib/server/services/reminders';
import { describeNotification } from '../../src/lib/shared/notifications';

let owner: User, member: User, other: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = {
	type: 'bug' as const,
	title: 'Remind me',
	descriptionHtml: '<p>x</p>',
	descriptionText: 'x',
	context: {}
};
const notes = (u: User) =>
	getDb().select().from(schema.notifications).where(eq(schema.notifications.userId, u.id)).all();

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	member = await makeUser();
	other = await makeUser();
	project = makeProject(owner, { key: 'REM' });
	join(owner, project, member);
});

describe('ticket reminders', () => {
	it('creates a private reminder and notifies once when due, even if the category is muted', () => {
		const t = createTicket(member, access(member, fresh()), input);
		getDb()
			.update(schema.users)
			.set({ notificationPrefs: { update: false } as never })
			.where(eq(schema.users.id, member.id))
			.run();
		const at = new Date(Date.now() + 3600_000);
		createReminder(member.id, access(member, fresh()), t, at, 'Check the fix');
		expect(ticketReminders(member.id, t.id)).toHaveLength(1);
		expect(ticketReminders(owner.id, t.id)).toHaveLength(0);
		expect(processDueReminders(new Date())).toBe(0);
		const before = notes(member).length;
		expect(processDueReminders(new Date(at.getTime() + 1000))).toBe(1);
		expect(processDueReminders(new Date(at.getTime() + 2000))).toBe(0);
		const mine = notes(member);
		expect(mine.length).toBe(before + 1);
		const n = mine.at(-1)!;
		expect(describeNotification({ ...n, actorName: null } as never)).toBe(
			'Reminder: Check the fix'
		);
		expect(ticketReminders(member.id, t.id)).toHaveLength(0);
	});

	it('validates times, limits open reminders and lets only the owner cancel', () => {
		const t = createTicket(member, access(member, fresh()), input);
		expect(() =>
			createReminder(member.id, access(member, fresh()), t, new Date(Date.now() - 1000), null)
		).toThrow(/future/);
		expect(() =>
			createReminder(
				member.id,
				access(member, fresh()),
				t,
				new Date(Date.now() + 400 * 864e5),
				null
			)
		).toThrow(/a year/);
		const r = createReminder(member.id, access(member, fresh()), t, presetTime('tomorrow'), null);
		expect(() => cancelReminder(owner.id, r.id)).toThrow(/not found/);
		cancelReminder(member.id, r.id);
		for (let i = 0; i < MAX_ACTIVE_REMINDERS; i++)
			createReminder(member.id, access(member, fresh()), t, presetTime('week'), null);
		expect(() =>
			createReminder(member.id, access(member, fresh()), t, presetTime('week'), null)
		).toThrow(/at most/);
	});

	it('never reminds someone who lost access, and outsiders cannot set reminders on private projects', () => {
		const t = createTicket(member, access(member, fresh()), input);
		expect(() =>
			createReminder(other.id, access(other, fresh()), t, presetTime('tomorrow'), null)
		).toThrow(/not found/);
		const at = new Date(Date.now() + 1000);
		createReminder(member.id, access(member, fresh()), t, at, null);
		removeMember(owner.id, fresh(), member.id, null);
		const before = notes(member).length;
		processDueReminders(new Date(at.getTime() + 1000));
		expect(notes(member).length).toBe(before);
	});

	it('presets land at 9:00 on the right day', () => {
		const now = new Date(2026, 0, 10, 15, 30);
		expect(presetTime('tomorrow', now)).toEqual(new Date(2026, 0, 11, 9));
		expect(presetTime('3days', now)).toEqual(new Date(2026, 0, 13, 9));
		expect(presetTime('week', now)).toEqual(new Date(2026, 0, 17, 9));
	});
});
