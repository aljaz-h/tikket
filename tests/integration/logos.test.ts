import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { findProjectById } from '../../src/lib/server/authz';
import { setProjectLogo, storeLogo } from '../../src/lib/server/services/project-logos';
import { setArchived } from '../../src/lib/server/services/projects';
import { findAttachment, originalPath } from '../../src/lib/server/uploads';
import { GET as getLogo } from '../../src/routes/api/project-logos/[id]/+server';
import type { Project, User } from '../../src/lib/server/db/schema';

let owner: User, member: User, outsider: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const image = (color = '#b8f779') =>
	sharp({ create: { width: 64, height: 64, channels: 3, background: color } })
		.png()
		.toBuffer();

async function fetchLogo(id: string, user: User | null) {
	try {
		const res = await getLogo({
			params: { id },
			locals: { user },
			request: new Request('http://x/')
		} as never);
		return res.status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	member = await makeUser();
	outsider = await makeUser();
	project = makeProject(owner, { key: 'SPL' }); // private
	join(owner, project, member);
});

describe('project logos', () => {
	it('lets owners set, replace and remove a logo; old files are deleted', async () => {
		const first = await storeLogo(await image(), {
			uploaderId: owner.id,
			projectId: project.id,
			name: 'a.png',
			pending: true
		});
		setProjectLogo(owner.id, access(owner, fresh()), first.id);
		expect(fresh().logoId).toBe(first.id);
		expect(findAttachment(first.id)?.attachedAt).toBeTruthy();

		const second = await storeLogo(await image('#000'), {
			uploaderId: owner.id,
			projectId: project.id,
			name: 'b.png',
			pending: true
		});
		setProjectLogo(owner.id, access(owner, fresh()), second.id);
		expect(fresh().logoId).toBe(second.id);
		expect(findAttachment(first.id)?.deletedAt).toBeTruthy();
		expect(fs.existsSync(originalPath(first))).toBe(false);

		setProjectLogo(owner.id, access(owner, fresh()), null);
		expect(fresh().logoId).toBeNull();
		expect(fs.existsSync(originalPath(second))).toBe(false);
	});

	it('rejects non-owners, foreign logos and other users’ previews', async () => {
		const logo = await storeLogo(await image(), {
			uploaderId: owner.id,
			projectId: project.id,
			name: 'a.png',
			pending: true
		});
		expect(() => setProjectLogo(member.id, access(member, fresh()), logo.id)).toThrow(/owners/);
		expect(() => setProjectLogo(outsider.id, access(outsider, fresh()), logo.id)).toThrow();

		const other = makeProject(owner, { key: 'OTH' });
		const foreign = await storeLogo(await image(), {
			uploaderId: owner.id,
			projectId: other.id,
			name: 'x.png',
			pending: true
		});
		expect(() => setProjectLogo(owner.id, access(owner, fresh()), foreign.id)).toThrow(
			/not available/
		);

		// A pending preview belongs to its uploader only.
		const admin = await makeUser('admin');
		const preview = await storeLogo(await image(), {
			uploaderId: admin.id,
			projectId: project.id,
			name: 'p.png',
			pending: true
		});
		expect(() => setProjectLogo(owner.id, access(owner, fresh()), preview.id)).toThrow(
			/not available/
		);

		setArchived(owner.id, fresh(), true, null);
		expect(() => setProjectLogo(owner.id, access(owner, fresh()), logo.id)).toThrow();
	});

	it('serves logos with the project’s visibility', async () => {
		const logo = await storeLogo(await image(), {
			uploaderId: owner.id,
			projectId: project.id,
			name: 'a.png',
			pending: true
		});
		// Unapplied previews: uploader only.
		expect(await fetchLogo(logo.id, owner)).toBe(200);
		expect(await fetchLogo(logo.id, member)).toBe(404);
		setProjectLogo(owner.id, access(owner, fresh()), logo.id);
		expect(await fetchLogo(logo.id, member)).toBe(200);
		expect(await fetchLogo(logo.id, outsider)).toBe(404); // private project
		expect(await fetchLogo(logo.id, null)).toBe(404);
		expect(await fetchLogo('0'.repeat(32), owner)).toBe(404);
	});
});
