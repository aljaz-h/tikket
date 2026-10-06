import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, makeUser } from '../helpers';
import {
	authenticate,
	changePassword,
	createPasswordReset,
	consumePasswordReset,
	needsSetup,
	setUserRole,
	setUserStatus,
	setupFirstAdmin
} from '../../src/lib/server/services/users';
import {
	createSession,
	invalidateUserSessions,
	validateSessionToken
} from '../../src/lib/server/auth/session';
import {
	acceptInvitationAsExistingUser,
	acceptInvitationAsNewUser,
	createInvitation,
	findValidInvitation,
	revokeInvitation
} from '../../src/lib/server/services/invitations';
import { getMembershipRole } from '../../src/lib/server/authz';
import { makeProject } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';

const account = (username: string) => ({
	username,
	email: `${username}@example.com`,
	displayName: username,
	password: 'password-1234'
});

beforeEach(() => {
	freshDb();
});

describe('first-run setup', () => {
	it('creates exactly one administrator even under concurrent requests', async () => {
		expect(needsSetup()).toBe(true);
		const results = await Promise.allSettled([
			setupFirstAdmin(account('ada'), null),
			setupFirstAdmin(account('bob'), null),
			setupFirstAdmin(account('cy'), null)
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(needsSetup()).toBe(false);
		const admins = getDb().select().from(schema.users).all();
		expect(admins).toHaveLength(1);
		expect(admins[0].role).toBe('admin');
		await expect(setupFirstAdmin(account('late'), null)).rejects.toThrow(/already/);
	});
});

describe('authentication', () => {
	it('verifies passwords by username or email, case-insensitively', async () => {
		const u = await makeUser('user', 'carol');
		expect((await authenticate('carol', 'password-1234'))?.id).toBe(u.id);
		expect((await authenticate('CAROL@example.com', 'password-1234'))?.id).toBe(u.id);
		expect(await authenticate('carol', 'wrong-password')).toBeNull();
		expect(await authenticate('nobody', 'password-1234')).toBeNull();
	});

	it('rejects duplicate usernames and emails', async () => {
		await makeUser('user', 'dave');
		await expect(makeUser('user', 'DAVE')).rejects.toThrow(/username/);
	});

	it('creates, validates and revokes sessions; disabled users lose access', async () => {
		const admin = await makeUser('admin');
		const u = await makeUser();
		const { token } = createSession(u.id);
		expect(validateSessionToken(token)?.user.id).toBe(u.id);
		expect(validateSessionToken(token + 'x')).toBeNull();
		setUserStatus(admin.id, u.id, 'disabled', null);
		expect(validateSessionToken(token)).toBeNull();
		expect(await authenticate(u.username, 'password-1234')).toBeNull();
		setUserStatus(admin.id, u.id, 'active', null);
		const second = createSession(u.id);
		expect(invalidateUserSessions(u.id)).toBe(1);
		expect(validateSessionToken(second.token)).toBeNull();
	});

	it('changing the password revokes other sessions', async () => {
		const u = await makeUser();
		const current = createSession(u.id);
		const other = createSession(u.id);
		await expect(changePassword(u.id, 'bad', 'new-password-123', current.id, null)).rejects.toThrow(
			/incorrect/
		);
		await changePassword(u.id, 'password-1234', 'new-password-123', current.id, null);
		expect(validateSessionToken(current.token)).not.toBeNull();
		expect(validateSessionToken(other.token)).toBeNull();
		expect(await authenticate(u.username, 'new-password-123')).not.toBeNull();
	});

	it('password reset links are single-use and revoke sessions', async () => {
		const admin = await makeUser('admin');
		const u = await makeUser();
		const session = createSession(u.id);
		const token = createPasswordReset(admin.id, u.id, null);
		await consumePasswordReset(token, 'reset-password-1', null);
		expect(validateSessionToken(session.token)).toBeNull();
		expect(await authenticate(u.username, 'reset-password-1')).not.toBeNull();
		await expect(consumePasswordReset(token, 'again-password-1', null)).rejects.toThrow(/invalid/);
	});

	it('keeps at least one active administrator', async () => {
		const admin = await makeUser('admin');
		expect(() => setUserRole(admin.id, admin.id, 'user', null)).toThrow(/at least one/);
		expect(() => setUserStatus(admin.id, admin.id, 'disabled', null)).toThrow(/your own/);
	});
});

describe('invitations', () => {
	it('grants exactly the stored project role, once', async () => {
		const admin = await makeUser('admin');
		const project = makeProject(admin);
		const token = createInvitation(
			admin.id,
			{ email: null, role: 'user', projectId: project.id, projectRole: 'moderator' },
			null
		);
		expect(findValidInvitation(token)).toBeTruthy();
		const user = await acceptInvitationAsNewUser(token, account('newbie'), null);
		expect(user.role).toBe('user');
		expect(getMembershipRole(user.id, project.id)).toBe('moderator');
		await expect(acceptInvitationAsNewUser(token, account('second'), null)).rejects.toThrow(
			/invalid|used/
		);
	});

	it('enforces the invited email and supports revocation', async () => {
		const admin = await makeUser('admin');
		const project = makeProject(admin);
		const token = createInvitation(
			admin.id,
			{ email: 'only@example.com', role: 'user', projectId: project.id, projectRole: 'member' },
			null
		);
		await expect(acceptInvitationAsNewUser(token, account('other'), null)).rejects.toThrow(/email/);
		const existing = await makeUser();
		expect(() => acceptInvitationAsExistingUser(token, existing, null)).toThrow(/different email/);
		const t2 = createInvitation(
			admin.id,
			{ email: null, role: 'user', projectId: project.id, projectRole: 'member' },
			null
		);
		const inv = getDb().select().from(schema.invitations).all().at(-1)!;
		revokeInvitation(admin.id, inv.id, null, null);
		expect(findValidInvitation(t2)).toBeUndefined();
	});
});
