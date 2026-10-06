import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, useDatabase, closeDatabase } from '../src/lib/server/db';
import { invalidateSettingsCache } from '../src/lib/server/settings';
import { resetAllLimiters } from '../src/lib/server/auth/rate-limit';
import { createUser } from '../src/lib/server/services/users';
import { createProject, addMember, type ProjectInput } from '../src/lib/server/services/projects';
import { accessForProject } from '../src/lib/server/authz';
import type { GlobalRole, ProjectRole } from '../src/lib/shared/constants';
import type { Project, User } from '../src/lib/server/db/schema';

/** Fresh, migrated database file for each test. */
export function freshDb() {
	closeDatabase();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikket-db-'));
	process.env.UPLOADS_DIR = path.join(dir, 'uploads');
	useDatabase(openDatabase(path.join(dir, 'test.db'), path.resolve('drizzle')));
	invalidateSettingsCache();
	resetAllLimiters();
	return dir;
}

let seq = 0;
export async function makeUser(role: GlobalRole = 'user', name?: string): Promise<User> {
	seq++;
	const username = name ?? `user${seq}`;
	return createUser(
		{
			username,
			email: `${username}@example.com`,
			displayName: `User ${username}`,
			password: 'password-1234',
			role
		},
		null,
		null
	);
}

export function makeProject(owner: User, overrides: Partial<ProjectInput> = {}): Project {
	seq++;
	return createProject(
		owner.id,
		{
			name: `Project ${seq}`,
			key: overrides.key ?? `P${seq}X`,
			description: null,
			icon: null,
			color: 'indigo',
			url: null,
			visibility: 'private',
			allowAnonymousRead: false,
			...overrides
		},
		owner.id,
		null
	);
}

export function join(owner: User, project: Project, user: User, role: ProjectRole = 'member') {
	addMember(owner.id, project, user.id, role, null);
}

export function access(user: User | null, project: Project) {
	return accessForProject(user, project);
}

export const actor = (u: User) => ({ id: u.id, role: u.role, status: u.status });
