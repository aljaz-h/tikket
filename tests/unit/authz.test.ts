import { describe, expect, it } from 'vitest';
import {
	canDeleteComment,
	canEditComment,
	canEditTicket,
	computeProjectAccess
} from '../../src/lib/server/authz';
import type { Project, Ticket, TicketComment } from '../../src/lib/server/db/schema';

const project = (over: Partial<Project> = {}): Project => ({
	id: 1,
	key: 'SPL',
	name: 'Spool',
	description: null,
	icon: null,
	logoId: null,
	accentColor: null,
	docsUrl: null,
	roadmapSettings: null,
	color: 'indigo',
	url: null,
	visibility: 'private',
	allowAnonymousRead: false,
	submissionPolicy: 'any_user',
	votingEnabled: true,
	attachmentsEnabled: true,
	commentsEnabled: true,
	editPolicy: 'while_open',
	ticketCounter: 0,
	createdById: 1,
	archivedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over
});
const user = { id: 5, role: 'user' as const, status: 'active' as const };
const admin = { id: 1, role: 'admin' as const, status: 'active' as const };

describe('computeProjectAccess', () => {
	it('hides private projects from non-members and anonymous visitors', () => {
		expect(computeProjectAccess(user, project(), null).canView).toBe(false);
		expect(computeProjectAccess(null, project(), null).canView).toBe(false);
	});

	it('lets members of a private project view and participate', () => {
		const a = computeProjectAccess(user, project(), 'member');
		expect(a.canView).toBe(true);
		expect(a.canSubmit).toBe(true);
		expect(a.isStaff).toBe(false);
		expect(a.isOwner).toBe(false);
	});

	it('gives administrators full access everywhere', () => {
		const a = computeProjectAccess(admin, project(), null);
		expect(a.canView && a.isStaff && a.isOwner && a.canSubmit).toBe(true);
	});

	it('distinguishes moderators from owners', () => {
		const mod = computeProjectAccess(user, project(), 'moderator');
		expect(mod.isStaff).toBe(true);
		expect(mod.isOwner).toBe(false);
		expect(computeProjectAccess(user, project(), 'owner').isOwner).toBe(true);
	});

	it('public projects: visible to signed-in users, anonymous only with read access enabled', () => {
		expect(computeProjectAccess(user, project({ visibility: 'public' }), null).canView).toBe(true);
		expect(computeProjectAccess(null, project({ visibility: 'public' }), null).canView).toBe(false);
		const anon = computeProjectAccess(
			null,
			project({ visibility: 'public', allowAnonymousRead: true }),
			null
		);
		expect(anon.canView).toBe(true);
		expect(anon.canSubmit || anon.canComment || anon.canVote).toBe(false);
	});

	it('respects the members-only submission policy on public projects', () => {
		const p = project({ visibility: 'public', submissionPolicy: 'members' });
		expect(computeProjectAccess(user, p, null).canSubmit).toBe(false);
		expect(computeProjectAccess(user, p, 'member').canSubmit).toBe(true);
	});

	it('treats disabled accounts like anonymous visitors', () => {
		const disabled = { ...user, status: 'disabled' as const };
		const a = computeProjectAccess(disabled, project(), 'owner');
		expect(a.canView).toBe(false);
		expect(a.isOwner).toBe(false);
	});

	it('makes archived projects read-only', () => {
		const a = computeProjectAccess(user, project({ archivedAt: new Date() }), 'owner');
		expect(a.canView).toBe(true);
		expect(a.canSubmit || a.canComment || a.canVote).toBe(false);
		expect(a.isOwner).toBe(true);
	});

	it('applies project feature toggles; staff may still comment', () => {
		const p = project({ votingEnabled: false, commentsEnabled: false, attachmentsEnabled: false });
		const member = computeProjectAccess(user, p, 'member');
		expect(member.canVote || member.canComment || member.canAttach).toBe(false);
		const mod = computeProjectAccess(user, p, 'moderator');
		expect(mod.canComment).toBe(true);
	});
});

describe('edit permissions', () => {
	const ticket = (over: Partial<Ticket> = {}) =>
		({ id: 1, reporterId: 5, status: 'open', ...over }) as Ticket;
	it('follows the project edit policy for authors', () => {
		const member = computeProjectAccess(user, project(), 'member');
		expect(canEditTicket(member, user, ticket())).toBe(true);
		expect(canEditTicket(member, user, ticket({ status: 'planned' }))).toBe(false);
		const always = computeProjectAccess(user, project({ editPolicy: 'always' }), 'member');
		expect(canEditTicket(always, user, ticket({ status: 'completed' }))).toBe(true);
		const never = computeProjectAccess(user, project({ editPolicy: 'never' }), 'member');
		expect(canEditTicket(never, user, ticket())).toBe(false);
	});
	it('never lets members edit other people’s tickets; staff can', () => {
		const member = computeProjectAccess(user, project(), 'member');
		expect(canEditTicket(member, user, ticket({ reporterId: 99 }))).toBe(false);
		const mod = computeProjectAccess(user, project(), 'moderator');
		expect(canEditTicket(mod, user, ticket({ reporterId: 99, status: 'completed' }))).toBe(true);
	});
	it('restricts comment editing to the author, deletion to author or staff', () => {
		const comment = { id: 1, authorId: 99, deletedAt: null } as TicketComment;
		const member = computeProjectAccess(user, project(), 'member');
		expect(canEditComment(member, user, comment)).toBe(false);
		expect(canDeleteComment(member, user, comment)).toBe(false);
		const mod = computeProjectAccess(user, project(), 'moderator');
		expect(canEditComment(mod, user, comment)).toBe(false);
		expect(canDeleteComment(mod, user, comment)).toBe(true);
		expect(canEditComment(member, user, { ...comment, authorId: 5 })).toBe(true);
	});
});
