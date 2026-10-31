import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, MEMBER, choose, goto, login } from './fixtures';

// Roadmap: Open column, drag & drop and the Move to… fallback, Assign to me, image export and the
// public live image. Runs after the other specs (serial, shared server).
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
test.beforeEach(({ page }) => {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
});

// Region names start with the status icon's text ("Open Open / Unplanned"); anchor them so
// "Planned" doesn't also match "Open / Unplanned".
const NAMES: Record<string, RegExp> = {
	'Open / Unplanned': /^Open Open \/ Unplanned/,
	Planned: /^Planned Planned/,
	'In Progress': /^In Progress In Progress/,
	'Recently completed': /^Completed Recently completed/
};
const column = (page: Page, name: string) => page.getByRole('region', { name: NAMES[name] });
const cards = (page: Page, name: string) => column(page, name).getByRole('listitem');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** A real mouse drag in small steps (HTML5 drag and drop needs intermediate moves). */
async function drag(page: Page, source: Locator, target: Locator) {
	await source.scrollIntoViewIfNeeded();
	const from = (await source.boundingBox())!;
	const to = (await target.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2 + 30, from.y + from.height / 2 + 10, { steps: 5 });
	await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 120), { steps: 12 });
	return async () => page.mouse.up();
}

async function firstCardRef(page: Page, name: string | RegExp) {
	const text = await cards(page, name).first().locator('.font-mono').first().innerText();
	return text.trim();
}

test('staff see four columns with the Open / Unplanned column first', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const headings = (await page.locator('section[aria-labelledby^="col-"] h2').allInnerTexts()).map(
		(h) => h.replace(/\s+/g, ' ').trim()
	);
	expect(headings).toHaveLength(4);
	[/Open \/ Unplanned \d+$/, /Planned \d+$/, /In Progress \d+$/, /Recently completed \d+$/].forEach(
		(pattern, i) => expect(headings[i]).toMatch(pattern)
	);
	await expect(cards(page, 'Open / Unplanned').first()).toBeVisible();
});

test('Move to… moves a ticket with the keyboard and keeps history', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const ref = await firstCardRef(page, 'Open / Unplanned');
	const trigger = page.getByRole('button', { name: `Actions for ${ref}` });
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByText(`Move ${ref} to…`)).toBeVisible();
	await page.getByRole('menuitem', { name: 'Planned' }).click();
	await expect(page.getByText(`${ref} moved to Planned`).first()).toBeVisible();
	await expect(cards(page, 'Planned').filter({ hasText: ref })).toHaveCount(1);
	await expect(cards(page, 'Open / Unplanned').filter({ hasText: ref })).toHaveCount(0);
	// Same ticket history as any status change.
	const number = ref.split('-')[1];
	await goto(page, `/p/spl/tickets/${number}`);
	await expect(page.getByText(/changed the status from Open to Planned/)).toBeVisible();
});

test('dragging a card changes its status; invalid targets explain themselves', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const ref = await firstCardRef(page, 'Planned');
	const card = cards(page, 'Planned').filter({ hasText: ref }).first();
	await (
		await drag(page, card, column(page, 'In Progress'))
	)();
	await expect(page.getByText(`${ref} moved to In Progress`).first()).toBeVisible();
	await expect(cards(page, 'In Progress').filter({ hasText: ref })).toHaveCount(1);

	// A workflow that needs a note for Completed: the drop target is marked invalid and nothing moves.
	await goto(page, '/p/spl/settings/workflow');
	await page
		.getByRole('group', { name: 'Require a note when changing the status to' })
		.getByRole('checkbox', { name: 'Completed' })
		.check();
	await page.getByRole('button', { name: 'Save workflow' }).click();
	await expect(page.getByText('Workflow saved').first()).toBeVisible();
	await goto(page, '/p/spl/roadmap');
	const moving = cards(page, 'In Progress').filter({ hasText: ref }).first();
	const target = column(page, 'Recently completed');
	const release = await drag(page, moving, target);
	await expect(
		target.getByText(/A note is required when changing the status to Completed/)
	).toBeVisible();
	await release();
	await expect(cards(page, 'In Progress').filter({ hasText: ref })).toHaveCount(1);
	await goto(page, '/p/spl/roadmap');
	await expect(cards(page, 'In Progress').filter({ hasText: ref })).toHaveCount(1);
	// The menu offers the same rules.
	await page.getByRole('button', { name: `Actions for ${ref}` }).click();
	await expect(page.getByRole('menuitem', { name: /Completed/ })).toHaveAttribute(
		'data-disabled',
		''
	);
	await page.keyboard.press('Escape');

	// Restore the defaults for anything that runs later.
	await goto(page, '/p/spl/settings/workflow');
	await page.getByRole('button', { name: 'Reset to defaults' }).click();
	await expect(page.getByText('Workflow saved').first()).toBeVisible();
});

test('Assign to me from a roadmap card and from the ticket page', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	const ref = await firstCardRef(page, 'Open / Unplanned');
	await page.getByRole('button', { name: `Actions for ${ref}` }).click();
	await page.getByRole('menuitem', { name: 'Assign to me' }).click();
	await expect(page.getByText(`${ref} assigned to you`).first()).toBeVisible();
	await page.getByRole('button', { name: `Actions for ${ref}` }).click();
	await expect(page.getByRole('menuitem', { name: 'Assigned to you' })).toBeVisible();
	await page.keyboard.press('Escape');

	// On the ticket page the action sits next to the assignee field.
	await goto(page, '/p/spl/tickets/2');
	const mine = page.getByRole('button', { name: 'Assign to me' });
	if (await mine.count()) {
		await mine.click();
		await expect(page.getByText('Assigned to you').first()).toBeVisible();
		await expect(mine).toHaveCount(0);
	}
	// Members never see it.
	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets/2');
	await expect(page.getByRole('button', { name: 'Assign to me' })).toHaveCount(0);
	await goto(page, '/p/spl/roadmap');
	await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
	await expect(page.locator('section[aria-labelledby="col-open"]')).toHaveCount(0); // staff-only by default
});

test('the roadmap can be exported as a PNG and respects visibility', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/roadmap');
	await expect(page.getByRole('link', { name: 'Export image' })).toHaveAttribute(
		'href',
		/roadmap\/export\.png\?download=1/
	);
	const res = await page.request.get('/p/spl/roadmap/export.png');
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('image/png');
	expect((await res.body()).subarray(0, 4)).toEqual(PNG);
	const etag = res.headers()['etag'];
	const again = await page.request.get('/p/spl/roadmap/export.png', {
		headers: { 'if-none-match': etag }
	});
	expect(again.status()).toBe(304);
	// Private project: nothing for anonymous visitors, neither export nor live image.
	expect((await request.get('/p/spl/roadmap/export.png')).status()).toBe(404);
	expect((await request.get('/public/projects/SPL/roadmap.png')).status()).toBe(404);
	expect((await request.get('/public/projects/NOPE/roadmap.png')).status()).toBe(404);
});

test('public live image: explicit opt-in, embed snippets, stops when the roadmap is restricted', async ({
	page,
	request
}) => {
	await login(page, ADMIN);
	// Private project: the option is there but cannot be switched on.
	await goto(page, '/p/spl/settings/roadmap');
	await expect(page.getByRole('switch', { name: /Allow public roadmap image/ })).toBeDisabled();

	// A public project with anonymous reading.
	await goto(page, '/projects/new');
	await page.fill('#name', 'Roadmap Share');
	await page.fill('#key', 'RMX');
	await page.getByText('Public', { exact: true }).click();
	await page.getByRole('switch', { name: /Allow read-only access without signing in/ }).click();
	await page.getByRole('button', { name: 'Create project' }).click();
	await page.waitForURL('**/p/rmx');

	// Off by default: existing and new projects are not exposed.
	expect((await request.get('/public/projects/RMX/roadmap.png')).status()).toBe(404);

	await goto(page, '/p/rmx/settings/roadmap');
	const toggle = page.getByRole('switch', { name: /Allow public roadmap image/ });
	await expect(toggle).toBeEnabled();
	await toggle.click();
	await page.getByRole('button', { name: 'Save visibility' }).click();
	await expect(page.getByText('Roadmap visibility saved').first()).toBeVisible();
	await expect(page.getByText(/^!\[Roadmap Share roadmap\]\(http/)).toBeVisible();
	await expect(page.getByText(/^\[!\[Roadmap Share roadmap\]\(http/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy Markdown' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copy Linked Markdown' })).toBeVisible();
	await expect(page.getByText(/GitHub and other sites cache remote images/)).toBeVisible();

	const live = await request.get('/public/projects/RMX/roadmap.png');
	expect(live.status()).toBe(200);
	expect(live.headers()['content-type']).toBe('image/png');
	expect(live.headers()['cross-origin-resource-policy']).toBe('cross-origin');
	expect(live.headers()['cache-control']).toMatch(/max-age=\d+/);
	expect((await live.body()).subarray(0, 4)).toEqual(PNG);
	const etag = live.headers()['etag'];
	expect(
		(
			await request.get('/public/projects/RMX/roadmap.png', { headers: { 'if-none-match': etag } })
		).status()
	).toBe(304);

	// Restricting the roadmap switches the public image off straight away.
	await choose(page, 'Who can see the roadmap', 'Project members');
	await expect(page.getByRole('switch', { name: /Allow public roadmap image/ })).toBeDisabled();
	await page.getByRole('button', { name: 'Save visibility' }).click();
	await expect(page.getByText('Roadmap visibility saved').first()).toBeVisible();
	expect((await request.get('/public/projects/RMX/roadmap.png')).status()).toBe(404);
});

test('phone widths: no page overflow, every column reachable, Move to… works', async ({ page }) => {
	await login(page, ADMIN);
	for (const width of [320, 375, 390, 430]) {
		await page.setViewportSize({ width, height: 800 });
		await goto(page, '/p/spl/roadmap');
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			`${width}px`
		).toBeLessThanOrEqual(width);
		// On phones the columns stack, so every one is reachable by scrolling down.
		for (const name of ['Open / Unplanned', 'Planned', 'In Progress', 'Recently completed']) {
			await column(page, name).getByRole('heading', { level: 2 }).scrollIntoViewIfNeeded();
			await expect(column(page, name).getByRole('heading', { level: 2 })).toBeInViewport();
		}
	}
	// Touch layout: the status fallback is always visible and works.
	await page.setViewportSize({ width: 390, height: 844 });
	await goto(page, '/p/spl/roadmap');
	const ref = await firstCardRef(page, 'Open / Unplanned');
	await page.getByRole('button', { name: `Actions for ${ref}` }).click();
	await page.getByRole('menuitem', { name: 'Planned' }).click();
	await expect(page.getByText(`${ref} moved to Planned`).first()).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 800 });
});

test('no console or hydration errors', () => {
	expect(errors.filter((e) => !/status of 40[34]/.test(e))).toEqual([]);
});
