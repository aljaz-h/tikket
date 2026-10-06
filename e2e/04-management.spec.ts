import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER, choose, goto, hydrated, login } from './fixtures';

// Runs after the other specs: SPL has tickets SPL-1 … SPL-5, Ada owns it, Mia is a member.
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
function track(page: Page) {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}
test.beforeEach(({ page }) => track(page));

test('releases: create, assign tickets, review and publish into the changelog', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/releases');
	await expect(page.getByText('No releases yet')).toBeVisible();
	await page.getByRole('button', { name: 'New release' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel(/Version or name/).fill('v0.15.0');
	await dialog.getByLabel(/Target date/).fill('2030-06-01');
	await dialog.getByRole('button', { name: 'Create release' }).click();
	await expect(page).toHaveURL(/\/p\/spl\/releases\/\d+$/);
	await hydrated(page);
	await expect(page.getByRole('heading', { name: /v0\.15\.0/ })).toBeVisible();
	await expect(page.getByText('No tickets assigned yet')).toBeVisible();

	await page.getByLabel('Tickets to add').fill('SPL-1, SPL-2');
	await page.getByRole('button', { name: 'Add tickets' }).click();
	await expect(page.getByText('Tickets added')).toBeVisible();
	await expect(page.getByRole('progressbar', { name: 'Release progress' })).toBeVisible();
	await expect(page.getByText(/1 of 2 tickets completed/)).toBeVisible();

	// Duplicate names are refused.
	await goto(page, '/p/spl/releases');
	await page.getByRole('button', { name: 'New release' }).first().click();
	await page
		.getByRole('dialog')
		.getByLabel(/Version or name/)
		.fill('V0.15.0');
	await page.getByRole('dialog').getByRole('button', { name: 'Create release' }).click();
	await expect(page.getByRole('dialog').getByText(/already exists/)).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('link', { name: /v0\.15\.0/ }).click();
	await hydrated(page);
	await page.getByRole('link', { name: 'Publish release' }).click();
	await hydrated(page);
	await expect(page.getByText(/1 ticket is not resolved/)).toBeVisible();
	await page.getByRole('button', { name: /Publish v0\.15\.0/ }).click();
	await expect(page.getByText('v0.15.0 published')).toBeVisible();
	await expect(page.getByText('Released', { exact: true }).first()).toBeVisible();
	// The unresolved ticket kept its status.
	await goto(page, '/p/spl/tickets/2');
	await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();

	await goto(page, '/p/spl/changelog');
	await expect(page.getByRole('heading', { name: 'v0.15.0' })).toBeVisible();
	await expect(page.getByRole('link', { name: /SPL-1/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /SPL-2/ })).toHaveCount(0);
});

test('milestones: create, assign from the ticket page, progress and completion', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/milestones');
	await page.getByRole('button', { name: 'New milestone' }).first().click();
	await page.getByRole('dialog').getByLabel(/Name/).fill('Improve Mobile Experience');
	await page.getByRole('dialog').getByRole('button', { name: 'Create milestone' }).click();
	await expect(page).toHaveURL(/\/p\/spl\/milestones\/\d+$/);

	await goto(page, '/p/spl/tickets/3');
	await choose(page, 'Milestone', 'Improve Mobile Experience');
	await expect(page.getByText('Milestone updated')).toBeVisible();
	await expect(page.getByText(/added this to milestone “Improve Mobile Experience”/)).toBeVisible();

	await goto(page, '/p/spl/milestones');
	await page.getByRole('link', { name: /Improve Mobile Experience/ }).click();
	await hydrated(page);
	await expect(page.getByText(/0 of 1 ticket completed/)).toBeVisible();
	await page.getByRole('button', { name: 'Mark completed' }).click();
	await expect(page.getByText('Milestone updated')).toBeVisible();
	await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Reopen' }).click();
	await expect(page.getByText(/reopened it/)).toBeVisible();
});

test('ticket list: columns, filters, quick actions and bulk release assignment', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/releases');
	await page.getByRole('button', { name: 'New release' }).first().click();
	await page
		.getByRole('dialog')
		.getByLabel(/Version or name/)
		.fill('v0.16.0');
	await page.getByRole('dialog').getByRole('button', { name: 'Create release' }).click();
	await expect(page).toHaveURL(/releases\/\d+$/);

	await goto(page, '/p/spl/tickets');
	// Columns
	await page.getByRole('button', { name: 'Choose columns' }).click();
	await page.getByRole('checkbox', { name: 'Target release' }).check();
	await page.getByRole('checkbox', { name: 'Milestone' }).check();
	await page.getByRole('button', { name: 'Apply columns' }).click();
	await expect(page).toHaveURL(/cols=.*release.*milestone/);
	await hydrated(page);

	// Bulk: target release
	await page.getByLabel('Select SPL-4').check();
	await page.getByLabel('Select SPL-5').check();
	await choose(page, 'Bulk change', 'v0.16.0');
	await page
		.getByRole('toolbar', { name: 'Bulk actions' })
		.getByRole('button', { name: 'Apply' })
		.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Update tickets' }).click();
	await expect(page.getByText('Updated 2 tickets')).toBeVisible();

	// Filter by release (staff-only filter)
	await goto(page, '/p/spl/tickets?release=none');
	await expect(page.getByRole('link', { name: 'Account page shows wrong plan' })).toHaveCount(0);

	// Quick action from the row menu
	await goto(page, '/p/spl/tickets');
	await page.getByRole('button', { name: 'Quick actions for SPL-4' }).click();
	await page.getByRole('menuitem', { name: 'Priority' }).click();
	await page.getByRole('menuitem', { name: 'Critical' }).click();
	await expect(page.getByText('SPL-4 updated')).toBeVisible();
	await goto(page, '/p/spl/tickets/4');
	await expect(page.getByText('Critical').first()).toBeVisible();
});

test('saved views: personal and shared, active state and previous/next', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets?status=open&sort=oldest');
	await page.getByRole('button', { name: 'Save current view' }).click();
	await page.getByRole('dialog').getByLabel(/Name/).fill('Open oldest first');
	await page.getByRole('dialog').getByText('Share with the project').click();
	await page.getByRole('dialog').getByRole('button', { name: 'Save view' }).click();
	await expect(page.getByText('View saved')).toBeVisible();
	await expect(page).toHaveURL(/saved=\d+/);
	const nav = page.getByRole('navigation', { name: 'Ticket views' });
	await expect(nav.getByRole('link', { name: 'Open oldest first' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	// Previous / next keep the list's filters and order.
	const first = page.getByRole('list', { name: 'Tickets' }).getByRole('link').first();
	await first.click();
	await hydrated(page);
	await expect(page.getByLabel(/Ticket 1 of \d+/)).toBeVisible();
	await page.getByRole('link', { name: 'Next ticket' }).click();
	await hydrated(page);
	await expect(page.getByLabel(/Ticket 2 of \d+/)).toBeVisible();
	await page.getByRole('link', { name: 'Previous ticket' }).click();
	await expect(page.getByLabel(/Ticket 1 of \d+/)).toBeVisible();

	// Members see the shared view but cannot manage it; their own views stay private.
	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets');
	const memberNav = page.getByRole('navigation', { name: 'Ticket views' });
	await expect(memberNav.getByRole('link', { name: 'Open oldest first' })).toBeVisible();
	await memberNav.getByRole('button', { name: 'Options for view Open oldest first' }).click();
	await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await goto(page, '/p/spl/tickets?type=bug');
	await page.getByRole('button', { name: 'Save current view' }).click();
	await page.getByRole('dialog').getByLabel(/Name/).fill('My bug list');
	await expect(page.getByRole('dialog').getByText('Share with the project')).toHaveCount(0);
	await page.getByRole('dialog').getByRole('button', { name: 'Save view' }).click();
	await expect(page.getByText('View saved')).toBeVisible();
	// Members never see staff planning tools.
	await expect(page.getByRole('button', { name: /Quick actions/ })).toHaveCount(0);
	expect((await page.goto('/p/spl/releases'))?.status()).toBe(404);

	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets');
	await expect(page.getByRole('link', { name: 'My bug list' })).toHaveCount(0);
});

test('overview: staff dashboard and simplified member view', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl');
	await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Upcoming releases' })).toBeVisible();
	await expect(page.getByText('v0.16.0')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Active milestones' })).toBeVisible();
	await expect(page.getByText('Awaiting review')).toBeVisible();

	await login(page, MEMBER);
	await goto(page, '/p/spl');
	await expect(page.getByRole('heading', { name: 'Recently completed' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0);
	await expect(page.getByText('v0.16.0')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Releases' })).toHaveCount(0);
});

test('mobile: views dropdown, ticket list and release page fit the screen', async ({ browser }) => {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	const page = await ctx.newPage();
	track(page);
	await login(page, ADMIN);
	for (const url of ['/p/spl/tickets', '/p/spl', '/p/spl/releases', '/p/spl/milestones']) {
		await goto(page, url);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			url
		).toBeLessThanOrEqual(390);
	}
	await goto(page, '/p/spl/tickets');
	await choose(page, 'Ticket view', 'Open oldest first');
	await expect(page).toHaveURL(/saved=\d+/);
	await ctx.close();
});

test('no console or hydration errors in management flows', () => {
	expect(errors.filter((e) => !/status of 40[0134]/.test(e))).toEqual([]);
});
