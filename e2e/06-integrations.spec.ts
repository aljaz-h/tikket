import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER, choose, goto, login, typeInEditor } from './fixtures';

// Runs after the other specs: Ada (admin) owns SPL, Mia is a member. Email and webhooks go to
// the local mocks in e2e/host-server.mjs (SMTP sink on :2525, webhook receiver on :4300).
test.describe.configure({ mode: 'serial' });

const HOST = 'http://127.0.0.1:4300';
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

test('admin configures SMTP; the password is never sent back', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/admin/email');
	await expect(page.getByText('Not configured').first()).toBeVisible();
	await page.getByLabel('Send emails').check();
	await page.getByLabel('SMTP host').fill('127.0.0.1');
	await choose(page, 'Encryption', /None/);
	await page.getByLabel('Port').fill('2525');
	await page.getByLabel('Username').fill('mailer');
	await page.locator('#password').fill('smtp-pass-123');
	await page.getByLabel('From name').fill('Tikket');
	await page.getByLabel('From address').fill('tikket@example.com');
	await page.getByRole('button', { name: 'Save email settings' }).click();
	await expect(page.getByText('Email settings saved').first()).toBeVisible();
	await page.reload();
	await expect(page.locator('#password')).toHaveAttribute('placeholder', '••••••••');
	await expect(page.locator('#password')).toHaveValue('');
	expect(await page.content()).not.toContain('smtp-pass-123');

	await page.getByLabel('Recipient').fill('ops@example.com');
	await page.getByRole('button', { name: 'Send test' }).click();
	await expect(page.getByText('Test email sent to ops@example.com').first()).toBeVisible();
	const mails = await (await request.get(`${HOST}/smtp/log`)).json();
	expect(mails.at(-1).raw).toContain('Email is working');
	expect(mails.at(-1).to.join()).toContain('ops@example.com');

	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
});

test('notification emails follow per-user preferences', async ({ page, request }) => {
	// Mia sees in-app and email columns.
	await login(page, MEMBER);
	await goto(page, '/settings/notifications');
	await expect(page.getByRole('switch', { name: 'Email: Mentions' })).toBeChecked();
	await page.getByRole('switch', { name: 'Email: New comments' }).uncheck();
	await page.getByRole('button', { name: 'Save preferences' }).click();
	await expect(page.getByText('Preferences saved').first()).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
	await page.setViewportSize({ width: 1280, height: 800 });

	// Mia comments on a ticket Ada follows → Ada gets an email.
	await goto(page, '/p/spl/tickets/1');
	await typeInEditor(page, 'Comment', 'Email me maybe');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await expect(page.getByRole('article', { name: /Comment by Mia Member/ }).last()).toBeVisible();
	await expect
		.poll(
			async () => {
				const mails: { to: string[]; raw: string }[] = await (
					await request.get(`${HOST}/smtp/log`)
				).json();
				return mails.some((m) => m.to.join().includes(ADMIN.email) && m.raw.includes('SPL-1'));
			},
			{ timeout: 20_000 }
		)
		.toBe(true);
});

test('forgot password emails a reset link when email is on', async ({ page, request }) => {
	await page.context().clearCookies();
	await goto(page, '/login');
	await page.getByRole('link', { name: 'Forgot password?' }).click();
	await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
	await page.getByLabel('Username or email').fill(MEMBER.email);
	await page.getByRole('button', { name: 'Email me a reset link' }).click();
	await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
	await expect
		.poll(
			async () => {
				const mails: { to: string[]; raw: string }[] = await (
					await request.get(`${HOST}/smtp/log`)
				).json();
				return mails.some(
					(m) =>
						m.to.join().includes(MEMBER.email) &&
						/\/reset\/[A-Za-z0-9_-]{20,}/.test(m.raw.replace(/=\r\n/g, ''))
				);
			},
			{ timeout: 20_000 }
		)
		.toBe(true);
});

test('integration cards, signed webhooks and delivery history', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/integrations');
	for (const name of ['GitHub', 'Discord', 'Webhooks'])
		await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
	await expect(page.getByText('Not configured')).toHaveCount(3);
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
	await page.setViewportSize({ width: 1280, height: 800 });

	await page.getByRole('link', { name: 'Manage' }).nth(2).click();
	await expect(page).toHaveURL(/integrations\/webhooks$/);
	await page.getByRole('button', { name: 'Add webhook' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Deploy bot');
	await dialog.getByLabel('Endpoint URL').fill(`${HOST}/hook?token=abc`);
	await dialog.getByText('ticket.assigned').click();
	await dialog.getByRole('button', { name: 'Add webhook' }).click();
	const secret = (await page.locator('code', { hasText: 'whsec_' }).textContent())!.trim();
	expect(secret).toMatch(/^whsec_/);
	await page.getByRole('button', { name: 'I saved it' }).click();
	await expect(page.locator('code', { hasText: 'whsec_' })).toHaveCount(0);
	await expect(page.getByText(`${HOST}/hook?…`)).toBeVisible();
	expect(await page.content()).not.toContain('token=abc');

	await page.getByRole('button', { name: 'Test' }).click();
	await expect(page.getByText(/Test delivered \(HTTP 204/).first()).toBeVisible();

	// A real event: new ticket → signed ticket.created delivery.
	await goto(page, '/new?project=SPL');
	await page.getByText('Bug Report').click();
	await page.getByLabel('Title').fill('Webhook smoke test');
	await typeInEditor(page, 'What happened?', 'Created to trigger a webhook.');
	await choose(page, /Which device/, 'TV'); // required template question from 02-phase2
	await page.getByRole('button', { name: 'Submit ticket' }).click();
	await expect(page).toHaveURL(/tickets\/\d+/);
	let hit: { headers: Record<string, string>; body: string } | undefined;
	await expect
		.poll(
			async () => {
				const log: { headers: Record<string, string>; body: string }[] = await (
					await request.get(`${HOST}/hook/log`)
				).json();
				hit = log.find((h) => h.headers['tikket-event'] === 'ticket.created');
				return !!hit;
			},
			{ timeout: 20_000 }
		)
		.toBe(true);
	const ts = hit!.headers['tikket-timestamp'];
	const expected = crypto.createHmac('sha256', secret).update(`${ts}.${hit!.body}`).digest('hex');
	expect(hit!.headers['tikket-signature']).toBe(`v1=${expected}`);
	expect(JSON.parse(hit!.body)).toMatchObject({
		version: '1',
		event: 'ticket.created',
		data: { ticket: { title: 'Webhook smoke test' } }
	});

	await goto(page, '/p/spl/settings/integrations/webhooks');
	await page.getByRole('button', { name: /Recent deliveries/ }).click();
	await expect(page.getByRole('cell', { name: 'ticket.created' })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
});

test('Discord webhook URLs are validated and masked', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/integrations/discord');
	await page.getByRole('button', { name: 'Add Discord webhook' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('#releases');
	await dialog.getByLabel('Discord webhook URL').fill('https://example.com/api/webhooks/1/2');
	await dialog.getByRole('button', { name: 'Add Discord webhook' }).click();
	await expect(page.getByText(/Paste a Discord webhook URL/).first()).toBeVisible();
	await dialog
		.getByLabel('Discord webhook URL')
		.fill('https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123');
	// Only releases, so the other tests don't queue messages for the (unreachable) Discord API.
	for (const label of ['Any new ticket', 'Completed tickets'])
		await dialog.getByText(label).click();
	await dialog.getByRole('button', { name: 'Add Discord webhook' }).click();
	await expect(page.getByText('discord.com/api/webhooks/1234…/••••••••').first()).toBeVisible();
	expect(await page.content()).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
});

test('GitHub: connect, receive a signed push, show it on the ticket', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/integrations/github');
	await page.getByLabel('Repository').fill('aljaz-h/spool-tracker');
	await page.getByRole('button', { name: 'Connect repository' }).click();
	await expect(page.getByText('Repository connected').first()).toBeVisible();
	const secret = (await page
		.locator('code')
		.filter({ hasText: /^[0-9a-f]{64}$/ })
		.textContent())!.trim();
	const hookUrl = (await page
		.locator('code')
		.filter({ hasText: '/api/integrations/github/' })
		.textContent())!.trim();
	await expect(page.getByText('Waiting for the first event').first()).toBeVisible();

	const push = (key: string) =>
		JSON.stringify({
			repository: { id: 777, full_name: 'aljaz-h/spool-tracker' },
			commits: [
				{
					id: 'c'.repeat(40),
					message: `fix: keep playback progress (${key}-1)`,
					author: { username: 'aljaz' }
				}
			]
		});
	const send = (body: string, sig: string, delivery: string) =>
		request.post(hookUrl.replace(/^https?:\/\/[^/]+/, ''), {
			data: body,
			headers: {
				'content-type': 'application/json',
				'x-github-event': 'push',
				'x-github-delivery': delivery,
				'x-hub-signature-256': sig
			}
		});
	const body = push('SPL');
	const sign = (b: string) =>
		`sha256=${crypto.createHmac('sha256', secret).update(b).digest('hex')}`;
	expect((await send(body, 'sha256=00', 'bad-sig-1')).status()).toBe(401);
	expect((await send(body, sign(body), 'delivery-0001')).status()).toBe(200);
	expect(await (await send(body, sign(body), 'delivery-0001')).json()).toMatchObject({
		message: 'Already processed'
	});

	await goto(page, '/p/spl/tickets/1');
	await expect(page.getByRole('heading', { name: 'Development' })).toBeVisible();
	await expect(page.getByRole('link', { name: /fix: keep playback progress/ })).toHaveAttribute(
		'href',
		`https://github.com/aljaz-h/spool-tracker/commit/${'c'.repeat(40)}`
	);
	// Merge automation is off by default.
	await goto(page, '/p/spl/settings/integrations/github');
	await expect(page.getByText('Connected', { exact: true }).first()).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'When a linked pull request is merged' })
	).toContainText('Do nothing');
});

test('roadmap visibility, branding and exports', async ({ page, browser }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/roadmap');
	await choose(page, 'Who can see the roadmap', 'Staff only');
	await page.getByRole('button', { name: 'Save visibility' }).click();
	await expect(page.getByText('Roadmap visibility saved').first()).toBeVisible();

	const memberCtx = await browser.newContext();
	const member = await memberCtx.newPage();
	await login(member, MEMBER);
	await goto(member, '/p/spl');
	await expect(
		member.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Roadmap' })
	).toHaveCount(0);
	expect((await member.goto('/p/spl/roadmap'))?.status()).toBe(404);
	expect((await member.request.get('/p/spl/settings/export/download?format=json')).status()).toBe(
		403
	);

	await goto(page, '/p/spl/settings/roadmap');
	await choose(page, 'Who can see the roadmap', 'Project members');
	await page.getByRole('button', { name: 'Save visibility' }).click();
	await expect(page.getByText('Roadmap visibility saved').first()).toBeVisible();
	await goto(member, '/p/spl/roadmap');
	await expect(member.getByRole('heading', { name: /Recently completed/ })).toBeVisible();
	await memberCtx.close();

	// Accent colour on the project's main action.
	await goto(page, '/p/spl/settings');
	await page.locator('#accentColor').fill('#3b82f6');
	await page.locator('#docsUrl').fill('https://docs.spool.example.com');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Project settings saved').first()).toBeVisible();
	await goto(page, '/p/spl');
	await expect(page.getByRole('link', { name: 'Docs & support' })).toHaveAttribute(
		'href',
		'https://docs.spool.example.com/'
	);
	const cta = page.getByRole('main').getByRole('link', { name: 'New ticket' }).first();
	expect(await cta.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
		'rgb(59, 130, 246)'
	);
	expect(await cta.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(13, 15, 17)'); // charcoal: 5.2:1 vs 3.7:1 for white

	// Exports.
	await goto(page, '/p/spl/settings/export');
	const json = await page.request.get('/p/spl/settings/export/download?format=json&scope=standard');
	expect(json.headers()['content-disposition']).toMatch(/attachment; filename="spl-export-/);
	const data = await json.json();
	expect(data).toMatchObject({ format: 'tikket-project', version: 1, scope: 'standard' });
	expect(JSON.stringify(data)).not.toMatch(/password|whsec_|@example\.com/);
	const csv = await (await page.request.get('/p/spl/settings/export/download?format=csv')).text();
	expect(csv.split('\r\n')[0]).toContain('Ticket ID,Title,Type,Status');
	const mine = await (await page.request.get('/settings/data/download?format=json')).json();
	expect(mine.format).toBe('tikket-personal');
	await page.setViewportSize({ width: 390, height: 844 });
	await noHorizontalOverflow(page);
});

test('no console or hydration errors', () => {
	expect(errors.filter((e) => !/status of 40[01349]/.test(e))).toEqual([]);
});
