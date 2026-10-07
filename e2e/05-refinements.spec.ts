import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN, MEMBER, goto, hydrated, login } from './fixtures';

// Runs after the other specs (Ada owns SPL, Mia is a member).
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
function track(page: Page) {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}
test.beforeEach(({ page }) => track(page));

test('new ticket: four types in an even 2 × 2 grid, stacked on phones', async ({ page }) => {
	await login(page, MEMBER);
	await goto(page, '/new?project=SPL');
	const boxes = await page
		.getByRole('radiogroup', { name: 'Ticket type' })
		.locator('label')
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
	expect(boxes).toHaveLength(4);
	const [a, b, c, d] = boxes as DOMRect[];
	expect(a.top).toBe(b.top);
	expect(c.top).toBe(d.top);
	expect(a.left).toBe(c.left);
	expect(b.left).toBe(d.left);
	for (const box of boxes as DOMRect[]) {
		expect(Math.round(box.width)).toBe(Math.round(a.width));
		expect(Math.round(box.height)).toBe(Math.round(a.height));
	}
	await page.getByText('General Feedback').click();
	await expect(page.getByRole('radio', { name: /General Feedback/ })).toBeChecked();

	await page.setViewportSize({ width: 390, height: 844 });
	const stacked = await page
		.getByRole('radiogroup', { name: 'Ticket type' })
		.locator('label')
		.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
	expect(new Set(stacked).size).toBe(1);
});

test('sidebar: aligned when collapsed, expands on empty space, state persists', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/');
	const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
	// Administration lives in the account menu only.
	await expect(
		sidebar.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Administration' })
	).toHaveCount(0);
	await sidebar.getByRole('button', { name: 'Account menu' }).click();
	await expect(page.getByRole('menuitem', { name: 'Administration' })).toBeVisible();
	await page.keyboard.press('Escape');

	await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
	await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
	// Every control shares one centre line and one size.
	const geometry = await sidebar
		.locator(
			'nav[aria-label="Main"] a, ul[aria-label="Projects"] a, button[aria-label="Search"], button[aria-label="Expand sidebar"], button[aria-label="Account menu"]'
		)
		.evaluateAll((els) =>
			els.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					centre: Math.round(r.left + r.width / 2),
					w: Math.round(r.width),
					h: Math.round(r.height)
				};
			})
		);
	expect(new Set(geometry.map((g) => g.centre)).size).toBe(1);
	expect(new Set(geometry.map((g) => `${g.w}x${g.h}`))).toEqual(new Set(['36x36']));
	const box = (await sidebar.boundingBox())!;
	const overflow = await sidebar.evaluate((el) => el.scrollWidth > el.clientWidth);
	expect(overflow).toBe(false);

	// Clicking a navigation item navigates and keeps the sidebar collapsed.
	await sidebar.getByRole('link', { name: 'Projects' }).click();
	await expect(page).toHaveURL(/\/projects$/);
	await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
	// The state survives a reload (rendered by the server, no flash).
	await page.reload();
	await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
	await hydrated(page);

	// Clicking empty space in the rail expands it.
	await page.mouse.click(box.x + box.width / 2, box.y + box.height - 120);
	await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
	await page.reload();
	await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();

	// Keyboard: the explicit toggle works with Enter.
	await hydrated(page);
	await sidebar.getByRole('button', { name: 'Collapse sidebar' }).focus();
	await page.keyboard.press('Enter');
	await expect(sidebar.getByRole('button', { name: 'Expand sidebar' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('project tabs: no scrollbar on desktop, all tabs reachable on phones', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl');
	const nav = page.getByRole('navigation', { name: 'Project' });
	const desktop = await nav.evaluate((el) => ({
		vertical: el.scrollHeight > el.clientHeight,
		horizontal: el.scrollWidth > el.clientWidth
	}));
	expect(desktop).toEqual({ vertical: false, horizontal: false });
	await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

	await page.setViewportSize({ width: 360, height: 800 });
	expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(false);
	const settings = nav.getByRole('link', { name: 'Settings' });
	await settings.focus();
	await expect(settings).toBeInViewport();
	await settings.click();
	await expect(page).toHaveURL(/\/p\/spl\/settings$/);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('settings: General dropdown shows the current section and follows history', async ({
	page
}) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings');
	const trigger = page.getByRole('button', { name: /^General settings:/ });
	await expect(trigger).toHaveText(/General/);
	for (const [item, label, url] of [
		['Members', 'Members', /settings\/members$/],
		['Labels', 'Labels', /settings\/labels$/],
		['Danger zone', 'Danger zone', /settings\/danger$/]
	] as const) {
		await trigger.click();
		await page.getByRole('menuitem', { name: item }).click();
		await expect(page).toHaveURL(url);
		await expect(trigger).toHaveText(new RegExp(label));
	}
	await page.goBack();
	await expect(page).toHaveURL(/settings\/labels$/);
	await expect(trigger).toHaveText(/Labels/);
	await page.goBack();
	await expect(trigger).toHaveText(/Members/);
	await page.goForward();
	await expect(trigger).toHaveText(/Labels/);
	// Keyboard: open with Enter, move with arrows, Escape closes.
	await trigger.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Labels' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
	// Old #anchors still work.
	await page.goto('/p/spl/settings#members');
	await expect(page).toHaveURL(/settings\/members$/);
	// Members can't reach project settings at all (unchanged owner-only guard).
	await login(page, MEMBER);
	for (const path of [
		'/p/spl/settings',
		'/p/spl/settings/members',
		'/p/spl/settings/labels',
		'/p/spl/settings/danger'
	])
		expect((await page.goto(path))?.status(), path).toBe(403);
});

test('project logo: upload, show everywhere, fall back, remove', async ({ page, request }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings');
	const logo = await sharp({
		create: { width: 300, height: 120, channels: 3, background: '#e5484d' }
	})
		.png()
		.toBuffer();
	await page
		.getByLabel('Logo image')
		.setInputFiles({ name: 'spool.png', mimeType: 'image/png', buffer: logo });
	await page.getByRole('button', { name: 'Upload logo' }).click();
	await expect(page.getByText('Logo updated')).toBeVisible();

	const sidebarIcon = page
		.getByRole('complementary', { name: 'Sidebar' })
		.locator('ul[aria-label="Projects"] img');
	await expect(sidebarIcon).toHaveCount(1);
	const src = (await sidebarIcon.getAttribute('src'))!;
	const res = await page.request.get(src);
	expect(res.status()).toBe(200);
	const meta = await sharp(await res.body()).metadata();
	expect([meta.format, meta.width, meta.height]).toEqual(['png', 256, 256]);
	// Private project: no logo for anonymous visitors.
	expect((await request.get(src)).status()).toBe(404);
	await goto(page, '/new');
	await expect(page.locator(`img[src="${src}"]`).first()).toBeVisible();

	// Invalid content is rejected with a clear message.
	await goto(page, '/p/spl/settings');
	await page.getByLabel('Logo image').setInputFiles({
		name: 'evil.png',
		mimeType: 'image/png',
		buffer: Buffer.from('<svg onload="alert(1)"></svg>')
	});
	await page.getByRole('button', { name: 'Replace logo' }).click();
	await expect(page.getByText(/PNG, JPEG or WebP/).first()).toBeVisible();

	// Website icon fetching refuses private targets (the project's URL is set to localhost).
	await page.getByLabel('Website').fill('http://127.0.0.1/');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Project settings saved')).toBeVisible();
	await page.getByRole('button', { name: 'Fetch website icon' }).click();
	await expect(page.getByText(/not publicly reachable/)).toBeVisible();
	await expect(sidebarIcon).toHaveCount(1); // existing logo kept

	await page.getByRole('button', { name: 'Remove logo' }).click();
	await expect(page.getByText('Logo removed')).toBeVisible();
	await expect(sidebarIcon).toHaveCount(0);
	await expect(
		page.getByRole('complementary', { name: 'Sidebar' }).getByText('S', { exact: true }).first()
	).toBeVisible();
	await page.getByLabel('Website').fill('');
	await page.getByRole('button', { name: 'Save changes' }).click();
});

test('no console or hydration errors', () => {
	expect(errors.filter((e) => !/status of 40[0134]/.test(e))).toEqual([]);
});
