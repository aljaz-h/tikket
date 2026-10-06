import { expect, test, type Page } from '@playwright/test';
import {
	ADMIN,
	choose,
	MEMBER,
	OUTSIDER,
	goto,
	hydrated,
	login,
	logout,
	pasteImage,
	pngBuffer,
	typeInEditor
} from './fixtures';

test.describe.configure({ mode: 'serial' });

let inviteLink = '';
let attachmentUrl = '';
const consoleErrors: string[] = [];

function trackConsole(page: Page) {
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(`${page.url()}: ${msg.text()}`);
	});
	page.on('pageerror', (err) => consoleErrors.push(`${page.url()}: ${err.message}`));
}

test.beforeEach(({ page }) => trackConsole(page));

test('1. initial administrator setup', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/setup$/);
	await hydrated(page);
	await page.getByLabel('Workspace name').fill('Acme Feedback');
	await page.getByLabel('Display name').fill(ADMIN.name);
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Email').fill(ADMIN.email);
	await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
	await page.getByLabel('Confirm password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Create administrator' }).click();
	await expect(page.getByRole('heading', { name: /Welcome back, Ada/ })).toBeVisible();
	// Setup is disabled once initialised.
	await page.goto('/setup');
	await expect(page).not.toHaveURL(/\/setup$/);
});

test('2. login and logout', async ({ page }) => {
	await goto(page, '/login');
	await page.getByLabel('Username or email').fill(ADMIN.username);
	await page.getByLabel('Password').fill('wrong-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('alert')).toContainText('Incorrect');
	await login(page, ADMIN);
	await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
	await logout(page);
	await page.goto('/my-tickets');
	await expect(page).toHaveURL(/\/login\?next=/);
});

test('3. project creation', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/projects/new');
	await page.getByLabel('Project name').fill('Spool');
	await expect(page.getByLabel('Key')).toHaveValue('SPL');
	await page.getByLabel('Description').fill('Podcast and TV tracker');
	await page.getByRole('button', { name: 'Create project' }).click();
	await expect(page).toHaveURL(/\/p\/spl$/);
	await expect(page.getByRole('heading', { name: 'Spool' })).toBeVisible();
	await hydrated(page);
	// A label for later triage.
	await goto(page, '/p/spl/settings');
	await page.getByLabel('Label name').first().fill('Playback');
	await page.getByRole('button', { name: 'Add label' }).click();
	await expect(page.getByText('Label created')).toBeVisible();
});

test('4. user invitation and membership', async ({ page, browser }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings');
	await page.getByRole('button', { name: 'Create link' }).click();
	const linkInput = page.getByLabel('Invitation link');
	await expect(linkInput).toBeVisible();
	inviteLink = await linkInput.inputValue();
	expect(inviteLink).toMatch(/\/invite\/[\w-]{20,}$/);

	// Create an outsider account directly for the access-control test.
	await goto(page, '/admin/users');
	await page.getByRole('button', { name: 'Create user' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Display name').fill(OUTSIDER.name);
	await dialog.getByLabel('Username').fill(OUTSIDER.username);
	await dialog.getByLabel('Email').fill(OUTSIDER.email);
	await dialog.getByLabel('Password', { exact: true }).fill(OUTSIDER.password);
	await dialog.getByLabel('Confirm password').fill(OUTSIDER.password);
	await dialog.getByRole('button', { name: 'Create user' }).click();
	await expect(page.getByRole('cell', { name: /Otto Outsider/ })).toBeVisible();

	const ctx = await browser.newContext();
	const guest = await ctx.newPage();
	trackConsole(guest);
	await goto(guest, new URL(inviteLink).pathname);
	await expect(guest.getByRole('heading', { name: 'You’re invited' })).toBeVisible();
	await guest.getByLabel('Display name').fill(MEMBER.name);
	await guest.getByLabel('Username').fill(MEMBER.username);
	await guest.getByLabel('Email').fill(MEMBER.email);
	await guest.getByLabel('Password', { exact: true }).fill(MEMBER.password);
	await guest.getByLabel('Confirm password').fill(MEMBER.password);
	await guest.getByRole('button', { name: 'Create account & join' }).click();
	await expect(guest).toHaveURL(/\/p\/spl$/);
	await expect(guest.getByRole('heading', { name: 'Spool' })).toBeVisible();
	await ctx.close();

	// The link cannot be reused.
	await page.goto(new URL(inviteLink).pathname);
	await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible();
});

test('5 & 6. normal user submits a ticket with screenshots (upload + paste)', async ({ page }) => {
	await login(page, MEMBER);
	await goto(page, '/p/spl');
	await page.getByRole('link', { name: 'New ticket' }).first().click();
	await expect(page).toHaveURL(/\/new\?project=SPL/);
	await hydrated(page);
	await page.getByText('Bug Report').click();
	await page.getByLabel('Title').fill('Progress bar does not refresh after watching');
	await typeInEditor(
		page,
		'What happened?',
		'When I mark an episode as watched, the progress bar still displays the previous percentage.'
	);
	await page.getByLabel('Affected URL').fill('https://example.com/shows/123');
	await page
		.getByLabel('What did you expect to happen?')
		.fill('The progress bar should update immediately.');

	const image = await pngBuffer('#3b82f6');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Add screenshots' }).click();
	await (await chooser).setFiles({ name: 'before.png', mimeType: 'image/png', buffer: image });
	await expect(page.getByRole('img', { name: 'before.png' })).toBeVisible();
	await pasteImage(page, (await pngBuffer('#22c55e')).toString('base64'));
	await expect(page.getByRole('img', { name: 'clipboard.png' })).toBeVisible();
	await expect(page.getByText('2 images')).toBeVisible();

	await page.getByRole('button', { name: 'Submit ticket' }).click();
	await expect(page).toHaveURL(/\/p\/spl\/tickets\/1/);
	await expect(page.getByRole('heading', { name: /SPL-1.*Progress bar/ })).toBeVisible();
	await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Unfollow' })).toBeVisible();
	await expect(page.getByText('The progress bar should update immediately.')).toBeVisible();
	const shots = page.getByRole('link', { name: /View before\.png/ });
	await expect(shots).toBeVisible();
	attachmentUrl = (await shots.getAttribute('href'))!;
	// Lightbox
	await shots.click();
	await expect(page.getByRole('dialog').getByText('before.png')).toBeVisible();
	await page.keyboard.press('Escape');
});

test('7 & 8. owner reviews, sets priority, assigns, changes status and comments', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets/1');
	await choose(page, 'Priority', 'High');
	await expect(page.getByText('Priority updated')).toBeVisible();
	await choose(page, 'Assignee', ADMIN.name);
	await expect(page.getByText('Assignee updated')).toBeVisible();
	await choose(page, 'Status', 'In Progress');
	await expect(page.getByText('Status updated')).toBeVisible();
	await expect(page.getByText('In Progress', { exact: true }).first()).toBeVisible();

	await typeInEditor(page, 'Comment', `Thanks @${MEMBER.username}, we can reproduce this.`);
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await expect(page.getByRole('article', { name: /Comment by Ada Admin/ })).toContainText(
		'we can reproduce this'
	);
	await expect(page.getByText(/changed the status from Open to In Progress/)).toBeVisible();
});

test('9 & 10. member sees notifications, comments and upvotes', async ({ page }) => {
	await login(page, MEMBER);
	await expect(page.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible();
	await goto(page, '/notifications');
	await expect(page.getByText('Ada Admin mentioned you')).toBeVisible();
	await goto(page, '/p/spl/tickets/1');
	await page.getByRole('button', { name: /Upvote/ }).click();
	await expect(page.getByRole('button', { name: /Voted/ })).toContainText('1');
	await typeInEditor(page, 'Comment', 'It happens on mobile too.');
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await expect(page.getByRole('article', { name: /Comment by Mia Member/ })).toBeVisible();
	// Normal users cannot change official metadata.
	await expect(page.getByLabel('Status')).toHaveCount(0);
});

test('11. ticket completion via the board', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets?view=board');
	await choose(page, 'Status of SPL-1', 'Completed');
	await expect(page.getByText('SPL-1 moved to Completed').first()).toBeVisible();
	await goto(page, '/p/spl/tickets/1');
	await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
	await goto(page, '/p/spl/roadmap');
	await expect(
		page.getByRole('region', { name: 'Completed' }).getByText('Progress bar does not refresh')
	).toBeVisible();
});

test('12. private project data stays private', async ({ page, request }) => {
	await login(page, OUTSIDER);
	await expect(page.getByRole('link', { name: 'Spool' })).toHaveCount(0);
	for (const url of ['/p/spl', '/p/spl/tickets/1', '/p/spl/roadmap']) {
		const res = await page.goto(url);
		expect(res?.status(), url).toBe(404);
	}
	const file = await page.goto(attachmentUrl);
	expect(file?.status()).toBe(404);
	const search = await page.request.get('/api/search?q=progress');
	expect((await search.json()).tickets).toHaveLength(0);
	const similar = await page.request.get('/api/similar?project=SPL&q=progress%20bar');
	expect((await similar.json()).items).toHaveLength(0);
	// Anonymous requests are rejected too.
	const anon = await request.get(attachmentUrl);
	expect(anon.status()).toBe(404);
	// Forged form posts to a ticket action are rejected.
	const forged = await page.request.post('/p/spl/tickets/1?/status', {
		form: { status: 'declined' },
		headers: { origin: 'http://localhost:4173' }
	});
	expect([403, 404]).toContain(forged.status());
});

test('13. mobile ticket submission', async ({ browser }) => {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	const page = await ctx.newPage();
	trackConsole(page);
	await login(page, MEMBER);
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(scrollWidth).toBeLessThanOrEqual(390);
	await page.getByRole('link', { name: 'New', exact: true }).click();
	await hydrated(page);
	await page.getByText('Feature Request').tap();
	await page.getByLabel('Title').fill('Export watch history as CSV');
	await typeInEditor(page, 'What would you like to see?', 'A button to download my history.');
	await page.getByRole('button', { name: 'Submit ticket' }).tap();
	await expect(page).toHaveURL(/\/p\/spl\/tickets\/2/);
	await expect(page.getByRole('heading', { name: /Export watch history/ })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(page.getByRole('dialog').getByRole('link', { name: 'My tickets' })).toBeVisible();
	await ctx.close();
});

test('no console errors during normal usage', () => {
	expect(consoleErrors.filter((e) => !/status of 40[134]/.test(e))).toEqual([]);
});
