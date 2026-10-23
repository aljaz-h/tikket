import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER, choose, goto, login } from './fixtures';

// Runs last: Ada (admin) owns SPL, Mia is a member. Automations run on the in-process queue.
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
test.beforeEach(({ page }) => {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
});

async function noHorizontalOverflow(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
		page.viewportSize()!.width
	);
}

let memberToken = '';
let apiTicket = 0;

test('owner builds an automation rule', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/automations');
	await page.getByRole('link', { name: 'New automation' }).click();
	await page.getByLabel('Name').fill('Raise API bugs');
	await page.getByRole('switch', { name: 'Disabled' }).check();
	await page.getByRole('button', { name: 'Add condition' }).click();
	await expect(page.getByRole('button', { name: 'Field' })).toContainText('Type');
	// A new rule starts with one action; make it a priority change.
	await expect(page.getByRole('button', { name: 'Action', exact: true })).toHaveCount(1);
	await choose(page, 'Action', 'Change priority');
	await choose(page, 'Action value', 'High');
	await page.getByRole('button', { name: 'Save automation' }).click();
	await expect(page.getByText('Automation saved').first()).toBeVisible();
	await goto(page, '/p/spl/settings/automations');
	await expect(page.getByRole('list', { name: 'Automation rules' })).toContainText(
		'Raise API bugs'
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
});

test('a personal access token is shown once and works with its scopes', async ({
	page,
	request
}) => {
	await login(page, MEMBER);
	await goto(page, '/settings/developer');
	await page.getByRole('button', { name: 'New token' }).click();
	await page.getByLabel('Name').fill('CLI');
	await page.getByRole('checkbox', { name: /tickets:write/ }).check();
	await page.getByRole('button', { name: 'Create token' }).click();
	const box = page.getByTestId('new-token');
	await expect(box).toBeVisible();
	memberToken = (await box.locator('code').first().textContent())!.trim();
	expect(memberToken).toMatch(/^tkt_pat_/);
	await page.reload();
	expect(await page.content()).not.toContain(memberToken);
	await expect(page.getByText(`${memberToken.slice(0, 12)}••••••••`)).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);

	const auth = { authorization: `Bearer ${memberToken}` };
	expect((await request.get('/api/v1/me')).status()).toBe(401);
	const me = await (await request.get('/api/v1/me', { headers: auth })).json();
	expect(me.data.user.username).toBe(MEMBER.username);
	expect(me.data.token.scopes).toEqual(['projects:read', 'tickets:read', 'tickets:write']);
	const created = await request.post('/api/v1/projects/SPL/tickets', {
		headers: { ...auth, 'idempotency-key': 'e2e-1' },
		data: {
			title: 'Crash when exporting from the CLI',
			description: 'Stack trace attached',
			type: 'bug'
		}
	});
	expect(created.status()).toBe(201);
	const body = await created.json();
	apiTicket = body.data.number;
	expect(body.data).toMatchObject({ status: 'open', source: 'api' });
	// The automation raises the priority shortly after (it runs on the queue).
	await expect
		.poll(
			async () =>
				(
					await (
						await request.get(`/api/v1/projects/SPL/tickets/${apiTicket}`, { headers: auth })
					).json()
				).data.priority,
			{ timeout: 20_000 }
		)
		.toBe('high');
	// No comments:read scope: comments are refused.
	const noScope = await request.get(`/api/v1/projects/SPL/tickets/${apiTicket}/comments`, {
		headers: auth
	});
	expect(noScope.status()).toBe(403);
	expect((await noScope.json()).error.code).toBe('insufficient_scope');
});

test('automation history shows the run', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/automations/history');
	const run = page.getByRole('list', { name: 'Automation runs' }).getByRole('button').first();
	await expect(run).toContainText('Raise API bugs');
	await expect(run).toContainText(`SPL-${apiTicket}`);
	await expect(run).toContainText('Success');
	await run.click();
	await expect(page.getByText('Priority: Medium → High')).toBeVisible();
	await goto(page, `/p/spl/tickets/${apiTicket}`);
	await expect(page.getByText('Raise API bugs').first()).toBeVisible();
});

test('project tokens are bound to their project', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/developer');
	await page.getByRole('button', { name: 'New token' }).click();
	await page.getByLabel('Name').fill('CI pipeline');
	await page.getByRole('button', { name: 'Create token' }).click();
	const token = (await page.getByTestId('new-token').locator('code').first().textContent())!.trim();
	expect(token).toMatch(/^tkt_prj_/);
	const auth = { authorization: `Bearer ${token}` };
	const projects = await (await request.get('/api/v1/projects', { headers: auth })).json();
	expect(projects.data.map((p: { key: string }) => p.key)).toEqual(['SPL']);
	const denied = await request.post('/api/v1/projects/SPL/tickets', {
		headers: auth,
		data: { title: 'Not allowed', description: 'x' }
	});
	expect(denied.status()).toBe(403);
	expect((await denied.json()).error.code).toBe('insufficient_scope');

	// Revoking stops it immediately.
	await page.getByRole('button', { name: 'Revoke' }).first().click();
	await page.getByRole('button', { name: 'Revoke token' }).click();
	await expect(page.getByText('Token revoked').first()).toBeVisible();
	const revoked = await request.get('/api/v1/projects', { headers: auth });
	expect(revoked.status()).toBe(401);
	expect((await revoked.json()).error.code).toBe('token_revoked');
});

test('API documentation and OpenAPI document', async ({ page, request }) => {
	// Not public: anonymous callers get a 401, an API token or a session gets the document.
	const anonymous = await request.get('/api/openapi.json');
	expect(anonymous.status()).toBe(401);
	expect(await anonymous.text()).not.toContain('openapi');
	const viaToken = await request.get('/api/openapi.json', {
		headers: { authorization: `Bearer ${memberToken}` }
	});
	expect(viaToken.status()).toBe(200);
	expect((await viaToken.json()).paths['/api/v1/projects/{key}/tickets'].post).toBeTruthy();
	// The documentation page needs an account.
	await page.goto('/docs/api');
	await expect(page).toHaveURL(/\/login\?next=%2Fdocs%2Fapi/);
	await login(page, ADMIN);
	await goto(page, '/docs/api');
	await expect(page.getByRole('heading', { name: 'API documentation' })).toBeVisible();
	const spec = await (await page.request.get('/api/openapi.json')).json();
	expect(spec.openapi).toBe('3.1.0');
	await expect(page.getByText('/api/v1/projects/{key}/tickets').first()).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
});

test('workflow settings require a note for chosen statuses', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/workflow');
	await page
		.getByRole('group', { name: 'Require a note when changing the status to' })
		.getByRole('checkbox', { name: 'Declined' })
		.check();
	await page.getByRole('button', { name: 'Save workflow' }).click();
	await expect(page.getByText('Workflow saved').first()).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
	await page.setViewportSize({ width: 1280, height: 800 });

	await goto(page, `/p/spl/tickets/${apiTicket}`);
	await choose(page, 'Status', 'Declined');
	await expect(page.getByText('(required, visible to everyone)')).toBeVisible();
	await page.getByRole('button', { name: 'Update status' }).click();
	// The browser blocks the empty required note; nothing changed.
	await expect(page.getByRole('button', { name: 'Status', exact: true })).toContainText('Declined');
	await page.getByRole('textbox', { name: /Explanation/ }).fill('Not reproducible');
	await page.getByRole('button', { name: 'Update status' }).click();
	await expect(page.getByText('Status updated').first()).toBeVisible();

	// Restore the defaults for anything that runs later.
	await goto(page, '/p/spl/settings/workflow');
	await page.getByRole('button', { name: 'Reset to defaults' }).click();
	await expect(page.getByText('Workflow saved').first()).toBeVisible();
});

test('owner imports tickets from CSV after reviewing them', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/import');
	await page.getByLabel('File').setInputFiles({
		name: 'legacy.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'ID,Title,Description,Type,Priority\nOLD-1,Imported login bug,Fails on Safari,Bug,High\nOLD-2,Imported dark mode idea,Please,Feature,Low\nOLD-3,x,too short,Bug,Low\n'
		)
	});
	await page.getByRole('button', { name: 'Upload and review' }).click();
	await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
	await expect(page.getByText('Row 4: Title is shorter than 3 characters')).toBeVisible();
	await expect(
		page
			.getByRole('table', { name: 'Preview of the first tickets' })
			.getByRole('cell', { name: 'Imported login bug' })
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.getByRole('button', { name: 'Import 2 tickets' }).click();
	await expect(page.getByText('Import finished').first()).toBeVisible();
	await page.getByRole('link', { name: 'Open tickets' }).click();
	await expect(page.getByText('Imported login bug').first()).toBeVisible();
});

test('no console errors on the v0.6 pages', () => {
	expect(errors).toEqual([]);
});
