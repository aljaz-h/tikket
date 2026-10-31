import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER, goto, login } from './fixtures';

// Roadmap redesign: column cap, completed grouping, per-status dates, creator avatars, slim
// cards with real vote buttons, type filter, grouping, milestone strip and the timeline view.
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
test.beforeEach(({ page }) => {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
});

const NAMES: Record<string, RegExp> = {
	open: /^Open Open \/ Unplanned/,
	planned: /^Planned Planned/,
	progress: /^In Progress In Progress/,
	done: /^Completed Recently completed/
};
const column = (page: Page, name: keyof typeof NAMES) =>
	page.getByRole('region', { name: NAMES[name] });
const cards = (page: Page, name: keyof typeof NAMES) => column(page, name).getByRole('listitem');

test('seed more than ten open tickets through the API', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/settings/developer');
	await page.getByRole('button', { name: 'New token' }).click();
	await page.getByLabel('Name').fill('Roadmap seed');
	await page.getByRole('checkbox', { name: /tickets:write/ }).check();
	await page.getByRole('button', { name: 'Create token' }).click();
	const token = (await page.getByTestId('new-token').locator('code').first().textContent())!.trim();
	for (let i = 1; i <= 12; i++) {
		const res = await request.post('/api/v1/projects/SPL/tickets', {
			headers: { authorization: `Bearer ${token}` },
			data: {
				title: `Roadmap cap ticket ${i}`,
				description: 'Created to test the column cap',
				type: i % 2 ? 'feature' : 'bug'
			}
		});
		expect(res.status()).toBe(201);
	}
});

test('a column shows at most ten cards, with the real total in the header', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const open = column(page, 'open');
	const total = Number((await open.getByRole('heading').innerText()).match(/(\d+)\s*$/)![1]);
	expect(total).toBeGreaterThan(10);
	// Ten cards plus the show-more control (a presentation row, not a listitem).
	await expect(cards(page, 'open')).toHaveCount(10);
	const more = open.getByRole('button', { name: `Show ${total - 10} more` });
	await expect(more).toHaveAttribute('aria-expanded', 'false');
	await more.click();
	await expect(cards(page, 'open')).toHaveCount(total);
	await open.getByRole('button', { name: 'Show less' }).click();
	await expect(cards(page, 'open')).toHaveCount(10);
	await expect(column(page, 'done').getByRole('link', { name: 'All tickets' })).toHaveAttribute(
		'href',
		/\/p\/spl\/tickets\?status=completed/
	);
});

test('cards show the right date, the creator and a real vote button', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	await expect(cards(page, 'open').first().locator('time')).toHaveText(/^Created /);
	// Make sure something is planned: move the first open ticket with the card menu.
	const ref = (await cards(page, 'open').first().locator('.font-mono').first().innerText()).trim();
	await page.getByRole('button', { name: `Actions for ${ref}` }).click();
	await page.getByRole('menuitem', { name: 'Planned' }).click();
	await expect(page.getByText(`${ref} moved to Planned`).first()).toBeVisible();
	await expect(cards(page, 'planned').filter({ hasText: ref }).locator('time')).toHaveText(
		/^Planned /
	);
	// Complete one as well, so there is a "Done" card to look at.
	const finished = (
		await cards(page, 'open').first().locator('.font-mono').first().innerText()
	).trim();
	await page.getByRole('button', { name: `Actions for ${finished}` }).click();
	await page.getByRole('menuitem', { name: 'Completed' }).click();
	await expect(page.getByText(`${finished} moved to Recently completed`).first()).toBeVisible();
	await expect(cards(page, 'done').filter({ hasText: finished }).locator('time')).toHaveText(
		/^Done /
	);
	// Completed tickets are grouped by when they were completed.
	await expect(column(page, 'done').getByRole('heading', { name: /^This week/ })).toBeVisible();
	// Staff see who created each ticket.
	await expect(
		cards(page, 'open')
			.first()
			.getByRole('img', { name: /^(Created by|Assigned to) / })
			.first()
	).toBeVisible();
	// The vote count is a button that votes with the ticket's own rules.
	const first = cards(page, 'open').first();
	const vote = first.getByRole('button', { name: /^Vote for / });
	const before = Number((await vote.innerText()).trim());
	await vote.click();
	await expect(first.getByRole('button', { name: /^Remove your vote from / })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(first.getByRole('button', { name: /^Remove your vote from / })).toContainText(
		String(before + 1)
	);
});

test('type chips filter the board and update the counts', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const bug = page.getByRole('button', { name: 'Bug', exact: true });
	await expect(bug).toHaveAttribute('aria-pressed', 'false');
	await bug.click();
	await expect(bug).toHaveAttribute('aria-pressed', 'true');
	await expect(page).toHaveURL(/type=bug/);
	for (const status of ['open', 'planned', 'progress', 'done'] as const) {
		// Every card left in the column is a bug (empty columns show a "No tickets" row).
		const real = cards(page, status).filter({ has: page.locator('.font-mono') });
		await expect
			.poll(async () => (await real.count()) - (await real.locator('.tone-bug').count()))
			.toBe(0);
	}
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await expect(page).not.toHaveURL(/type=/);
});

test('group by milestone and month; timeline view', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	await expect(page.getByRole('list', { name: 'Milestones' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Milestones' })).toContainText(/\d+ \/ \d+ done/);
	const group = page.getByRole('button', { name: 'Group by' });
	await group.click();
	await page.getByRole('option', { name: 'Milestone' }).click();
	await expect(page).toHaveURL(/group=milestone/);
	await expect(page.getByRole('heading', { name: /No milestone/ })).toBeVisible();
	await group.click();
	await page.getByRole('option', { name: 'Month' }).click();
	await expect(page.getByRole('heading', { name: /\d{4}\s+\d+$/ }).first()).toBeVisible();

	await page.getByRole('button', { name: 'Timeline' }).click();
	await expect(page).toHaveURL(/view=timeline/);
	const timeline = page.getByRole('region', { name: 'Roadmap timeline' });
	await expect(timeline).toBeVisible();
	await expect(timeline.getByText('Today', { exact: true })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Legend' })).toBeVisible();
	await expect(timeline.getByText('Recently completed')).toBeVisible();
	await page.getByRole('button', { name: 'Board', exact: true }).click();
	await expect(page).not.toHaveURL(/view=/);
});

test('timeline scrolls sideways on narrow screens without widening the page', async ({ page }) => {
	await login(page, ADMIN);
	await page.setViewportSize({ width: 390, height: 844 });
	await goto(page, '/p/spl/roadmap?view=timeline');
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	const region = page.getByRole('region', { name: 'Roadmap timeline' });
	expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
	await page.setViewportSize({ width: 1280, height: 800 });
});

test('visitors do not see who created tickets and cannot move cards', async ({ page }) => {
	await login(page, MEMBER);
	await goto(page, '/p/spl/roadmap');
	await expect(page.getByRole('img', { name: /^Created by / })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
});

test('no console or hydration errors', () => {
	expect(errors.filter((e) => !/status of 40[34]/.test(e))).toEqual([]);
});
