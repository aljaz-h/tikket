import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import {
	assignTicket,
	changePriority,
	changeStatus,
	createTicket,
	getTicket,
	getTicketDetail,
	setFollow,
	setTicketLabels,
	setVote,
	updateTicketContent
} from '../../src/lib/server/services/tickets';
import {
	addComment,
	deleteComment,
	editComment,
	getComment
} from '../../src/lib/server/services/comments';
import { listNotifications, unreadCount } from '../../src/lib/server/services/notifications';
import { createLabel, setArchived } from '../../src/lib/server/services/projects';
import { queryTickets, similarTickets, globalSearch } from '../../src/lib/server/services/search';
import {
	findAttachment,
	pendingAttachmentsFor,
	storeImage,
	UploadError
} from '../../src/lib/server/uploads';
import { findProjectById } from '../../src/lib/server/authz';
import { parseTicketFilters } from '../../src/lib/shared/filters';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../src/lib/server/db';
import type { User, Project } from '../../src/lib/server/db/schema';

const input = (
	title = 'Progress bar does not refresh',
	extra: Partial<Parameters<typeof createTicket>[2]> = {}
) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: '<p>The progress bar keeps the old value</p>',
	descriptionText: 'The progress bar keeps the old value',
	context: { expected: 'It updates' },
	...extra
});

let owner: User, member: User, outsider: User, project: Project;
const fresh = (p: Project) => findProjectById(p.id)!;

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	member = await makeUser();
	outsider = await makeUser();
	project = makeProject(owner, { key: 'SPL' });
	join(owner, project, member);
});

async function png(width = 40, height = 30) {
	const buf = await sharp({ create: { width, height, channels: 3, background: '#4455ff' } })
		.png()
		.toBuffer();
	return new File([new Uint8Array(buf)], 'screen shot.png', { type: 'image/png' });
}

describe('ticket creation', () => {
	it('allocates sequential numbers per project, starting at 1', async () => {
		const other = makeProject(owner, { key: 'KAN' });
		const a = createTicket(member, access(member, project), input());
		const b = createTicket(owner, access(owner, project), input('Second'));
		const c = createTicket(owner, access(owner, other), input('Other project'));
		expect([a.number, b.number, c.number]).toEqual([1, 2, 1]);
		expect(fresh(project).ticketCounter).toBe(2);
		// Numbers never repeat even when many tickets are created back to back.
		const numbers = Array.from(
			{ length: 25 },
			(_, i) => createTicket(member, access(member, project), input(`Bulk ${i}`)).number
		);
		expect(new Set(numbers).size).toBe(25);
		expect(Math.max(...numbers)).toBe(27);
	});

	it('defaults to Open / Medium, follows the reporter and records activity', () => {
		const t = createTicket(member, access(member, project), input());
		expect(t.status).toBe('open');
		expect(t.priority).toBe('medium');
		const detail = getTicketDetail(member, t);
		expect(detail.isFollowing).toBe(true);
		expect(detail.activity.map((a) => a.type)).toEqual(['created']);
	});

	it('notifies project staff about new tickets', () => {
		createTicket(member, access(member, project), input());
		expect(unreadCount(owner.id)).toBe(1);
		expect(listNotifications(owner.id)[0].type).toBe('new_ticket');
	});

	it('refuses submissions from users without access', () => {
		expect(() => createTicket(outsider, access(outsider, project), input())).toThrow();
		setArchived(owner.id, project, true, null);
		expect(() => createTicket(member, access(member, fresh(project)), input())).toThrow();
	});
});

describe('attachments', () => {
	it('stores validated images as pending uploads and attaches them on submit', async () => {
		const att = await storeImage(await png(), { uploaderId: member.id });
		expect(att.mimeType).toBe('image/png');
		expect(att.width).toBe(40);
		expect(att.hasThumbnail).toBe(true);
		expect(att.originalName).toBe('screen shot.png');
		// Other users cannot claim someone else's pending upload.
		expect(pendingAttachmentsFor(outsider.id, [att.id])).toHaveLength(0);
		const t = createTicket(member, access(member, project), input(), [att.id]);
		const stored = findAttachment(att.id)!;
		expect(stored.ticketId).toBe(t.id);
		expect(stored.projectId).toBe(project.id);
		expect(getTicketDetail(member, t).attachments).toHaveLength(1);
	});

	it('rejects files that are not images regardless of the declared type', async () => {
		const fake = new File([new TextEncoder().encode('<script>alert(1)</script>')], 'evil.png', {
			type: 'image/png'
		});
		await expect(storeImage(fake, { uploaderId: member.id })).rejects.toBeInstanceOf(UploadError);
	});

	it('cannot attach another user’s upload', async () => {
		const att = await storeImage(await png(), { uploaderId: outsider.id });
		const t = createTicket(member, access(member, project), input(), [att.id]);
		expect(getTicketDetail(member, t).attachments).toHaveLength(0);
		expect(findAttachment(att.id)!.attachedAt).toBeNull();
	});
});

describe('editing', () => {
	it('lets authors edit open tickets and records the change', () => {
		const t = createTicket(member, access(member, project), input());
		updateTicketContent(member, access(member, project), t, input('Renamed title'));
		const updated = getTicket(project.id, t.number)!;
		expect(updated.title).toBe('Renamed title');
		expect(getTicketDetail(member, updated).activity.at(-1)?.type).toBe('edited');
	});

	it('blocks authors once the ticket has been triaged (while_open policy)', () => {
		const t = createTicket(member, access(member, project), input());
		changeStatus(owner, access(owner, project), t, { status: 'planned', note: null });
		expect(() =>
			updateTicketContent(member, access(member, project), getTicket(project.id, 1)!, input('x'))
		).toThrow(/cannot edit/);
	});
});

describe('status, priority and assignment', () => {
	it('only staff can change status; changes are recorded and notify followers', () => {
		const t = createTicket(member, access(member, project), input());
		expect(() =>
			changeStatus(member, access(member, project), t, { status: 'planned', note: null })
		).toThrow(/staff/);
		changeStatus(owner, access(owner, project), t, { status: 'completed', note: 'Fixed in 1.2' });
		const done = getTicket(project.id, 1)!;
		expect(done.status).toBe('completed');
		expect(done.completedAt).not.toBeNull();
		expect(done.resolutionNote).toBe('Fixed in 1.2');
		const notes = listNotifications(member.id);
		expect(notes[0].type).toBe('status');
		expect(notes[0].data).toMatchObject({ from: 'open', to: 'completed' });
		// Reopening clears the closed timestamp.
		changeStatus(owner, access(owner, project), done, { status: 'open', note: null });
		const reopened = getTicket(project.id, 1)!;
		expect(reopened.closedAt).toBeNull();
		const activity = getTicketDetail(owner, reopened).activity.filter((a) => a.type === 'status');
		expect(activity.map((a) => a.data.effect)).toEqual(['completed', 'reopened']);
	});

	it('marks duplicates against a ticket in the same project', () => {
		const original = createTicket(member, access(member, project), input('Original'));
		const dup = createTicket(owner, access(owner, project), input('Copy'));
		const other = makeProject(owner, { key: 'KAN' });
		createTicket(owner, access(owner, other), input('Other'));
		expect(() =>
			changeStatus(owner, access(owner, project), dup, { status: 'duplicate', note: null })
		).toThrow();
		expect(() =>
			changeStatus(owner, access(owner, project), dup, {
				status: 'duplicate',
				note: null,
				duplicateOf: 'SPL-99'
			})
		).toThrow(/No ticket/);
		expect(() =>
			changeStatus(owner, access(owner, project), dup, {
				status: 'duplicate',
				note: null,
				duplicateOf: 'KAN-1'
			})
		).toThrow();
		changeStatus(owner, access(owner, project), dup, {
			status: 'duplicate',
			note: null,
			duplicateOf: 'SPL-1'
		});
		const after = getTicket(project.id, dup.number)!;
		expect(after.duplicateOfId).toBe(original.id);
		expect(getTicketDetail(owner, original).duplicates.map((d) => d.number)).toEqual([dup.number]);
	});

	it('records priority changes and assignments to staff only', () => {
		const t = createTicket(member, access(member, project), input());
		expect(() => changePriority(member, access(member, project), t, 'high')).toThrow();
		changePriority(owner, access(owner, project), t, 'critical');
		expect(getTicket(project.id, 1)!.priority).toBe('critical');
		expect(() => assignTicket(owner, access(owner, project), t, member.id)).toThrow(/staff/);
		assignTicket(owner, access(owner, project), t, owner.id);
		expect(getTicket(project.id, 1)!.assigneeId).toBe(owner.id);
		const types = getTicketDetail(owner, t).activity.map((a) => a.type);
		expect(types).toContain('priority');
		expect(types).toContain('assigned');
	});

	it('only applies labels that belong to the project', () => {
		const t = createTicket(member, access(member, project), input());
		const label = createLabel(project.id, 'iOS', 'sky');
		const other = makeProject(owner, { key: 'KAN' });
		const foreign = createLabel(other.id, 'Foreign', 'rose');
		setTicketLabels(owner, access(owner, project), t, [label.id, foreign.id]);
		expect(getTicketDetail(owner, t).labels.map((l) => l.name)).toEqual(['iOS']);
	});
});

describe('voting', () => {
	it('allows one vote per user and keeps the count consistent', () => {
		const t = createTicket(member, access(member, project), input());
		const a = access(member, project);
		expect(setVote(member, a, t, true)).toBe(1);
		expect(setVote(member, a, t, true)).toBe(1);
		expect(setVote(owner, access(owner, project), t, true)).toBe(2);
		expect(setVote(member, a, t, false)).toBe(1);
		expect(setVote(member, a, t, false)).toBe(1);
		expect(getTicket(project.id, 1)!.priority).toBe('medium');
		const rows = getDb()
			.select()
			.from(schema.ticketVotes)
			.where(eq(schema.ticketVotes.ticketId, t.id))
			.all();
		expect(rows).toHaveLength(1);
	});

	it('denies votes on inaccessible tickets or when voting is off', () => {
		const t = createTicket(member, access(member, project), input());
		expect(() => setVote(outsider, access(outsider, project), t, true)).toThrow();
		getDb()
			.update(schema.projects)
			.set({ votingEnabled: false })
			.where(eq(schema.projects.id, project.id))
			.run();
		expect(() => setVote(member, access(member, fresh(project)), t, true)).toThrow();
	});
});

describe('comments and notifications', () => {
	it('notifies followers and mentioned users, respecting access and preferences', async () => {
		const t = createTicket(member, access(member, project), input());
		addComment(owner, access(owner, project), t, {
			html: `<p>Thanks @${member.username} and @${outsider.username}</p>`,
			text: `Thanks @${member.username} and @${outsider.username}`
		});
		const notes = listNotifications(member.id);
		expect(notes[0].type).toBe('mention');
		// The outsider cannot see the private project, so they are not notified.
		expect(unreadCount(outsider.id)).toBe(0);
		// Commenters follow the ticket automatically.
		expect(getTicketDetail(owner, t).isFollowing).toBe(true);
		addComment(member, access(member, project), t, {
			html: '<p>Any update?</p>',
			text: 'Any update?'
		});
		expect(listNotifications(owner.id).filter((n) => n.type === 'comment')).toHaveLength(1);
	});

	it('supports editing own comments and moderator removal', () => {
		const t = createTicket(member, access(member, project), input());
		const c = addComment(member, access(member, project), t, {
			html: '<p>first</p>',
			text: 'first'
		});
		editComment(member, access(member, project), c, { html: '<p>edited</p>', text: 'edited' });
		const edited = getComment(t.id, c.id)!;
		expect(edited.editedAt).not.toBeNull();
		expect(() =>
			editComment(owner, access(owner, project), edited, { html: '<p>x</p>', text: 'x' })
		).toThrow();
		deleteComment(owner, access(owner, project), edited);
		const removed = getComment(t.id, c.id)!;
		expect(removed.deletedAt).not.toBeNull();
		expect(removed.bodyHtml).toBe('');
		expect(getTicket(project.id, 1)!.commentCount).toBe(0);
		expect(getTicketDetail(owner, t).activity.at(-1)?.type).toBe('comment_removed');
	});

	it('follow / unfollow toggles notifications', () => {
		const t = createTicket(member, access(member, project), input());
		setFollow(member, t, false);
		changeStatus(owner, access(owner, project), t, { status: 'planned', note: null });
		// The reporter is always told about status changes on their own ticket.
		expect(listNotifications(member.id).filter((n) => n.type === 'status')).toHaveLength(1);
	});
});

describe('search and access control', () => {
	it('filters, sorts and finds similar tickets with FTS', () => {
		const a = createTicket(member, access(member, project), input('Watched progress not updating'));
		createTicket(member, access(member, project), input('Login page crashes', { type: 'bug' }));
		createTicket(
			member,
			access(member, project),
			input('Dark mode for settings', { type: 'feature' })
		);
		setVote(owner, access(owner, project), a, true);
		const base = {
			scope: eq(schema.tickets.projectId, project.id),
			pageSize: 10,
			projectKey: 'SPL'
		};
		const f = (q: string) => ({ ...base, filters: parseTicketFilters(new URLSearchParams(q)) });
		expect(queryTickets(f('q=crash')).rows.map((r) => r.title)).toEqual(['Login page crashes']);
		expect(queryTickets(f('q=SPL-3')).rows.map((r) => r.number)).toEqual([3]);
		expect(queryTickets(f('type=feature')).total).toBe(1);
		expect(queryTickets(f('sort=votes')).rows[0].number).toBe(1);
		const similar = similarTickets(project.id, 'Episode progress is not updating');
		expect(similar[0].number).toBe(1);
	});

	it('never leaks private tickets through global search', () => {
		createTicket(member, access(member, project), input('Secret roadmap item'));
		const pub = makeProject(owner, { key: 'PUB', visibility: 'public' });
		createTicket(owner, access(owner, pub), input('Public secret-free item'));
		expect(globalSearch(member, 'secret').tickets).toHaveLength(2);
		expect(globalSearch(outsider, 'secret').tickets.map((t) => t.projectKey)).toEqual(['PUB']);
		expect(globalSearch(null, 'secret').tickets).toHaveLength(0);
	});
});
