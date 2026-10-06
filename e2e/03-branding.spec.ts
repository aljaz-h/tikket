import { expect, test, type Page } from '@playwright/test';
import { ADMIN, choose, goto, login } from './fixtures';

// Runs after the other specs: Ada (admin) and the SPL project with several tickets exist.
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
function track(page: Page) {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
}
test.beforeEach(({ page }) => track(page));

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('brand assets are served', async ({ request }) => {
	const icon = await request.get('/favicon.svg');
	expect(icon.status()).toBe(200);
	expect(icon.headers()['content-type']).toContain('image/svg+xml');
	expect(await icon.text()).toContain('Tikket icon');
	for (const path of ['/favicon-32.png', '/apple-touch-icon.png', '/icon-512.png'])
		expect((await request.get(path)).status(), path).toBe(200);
	const manifest = await (await request.get('/manifest.webmanifest')).json();
	expect(manifest.name).toBe('Tikket');
	const html = await (await request.get('/login')).text();
	expect(html).toMatch(/rel="icon" href="[^"]*favicon\.svg"/);
	expect(html).toContain('name="theme-color" content="#0d0f11"');
});

test('dark is the default theme, light can be chosen and reverted', async ({ page }) => {
	await login(page, ADMIN);
	expect(await page.evaluate(() => document.documentElement.className)).toContain('dark');
	expect(await bg(page)).toBe('rgb(13, 15, 17)');
	const primary = page.getByRole('link', { name: 'New ticket' }).first();
	expect(await primary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
		'rgb(184, 247, 121)'
	);

	await goto(page, '/settings/profile');
	await choose(page, 'Theme', 'Light');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('html.light')).toHaveCount(1, { timeout: 10_000 });
	await page.waitForSelector('html[data-hydrated]');
	expect(await bg(page)).toBe('rgb(245, 246, 244)');

	await choose(page, 'Theme', 'Dark');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('html.dark')).toHaveCount(1, { timeout: 10_000 });
});

test('custom dropdowns work with the keyboard and submit their form', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets');
	const sort = page.getByRole('button', { name: 'Sort' });
	await sort.focus();
	await page.keyboard.press('Enter');
	const listbox = page.getByRole('listbox');
	await expect(listbox).toBeVisible();
	await expect(listbox.getByRole('option', { name: 'Newest' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(listbox).toBeHidden();
	await expect(sort).toBeFocused();
	await choose(page, 'Sort', 'Newest');
	await expect(page).toHaveURL(/sort=newest/);
	await expect(page.getByRole('button', { name: 'Sort' })).toContainText('Newest');
});

test('ticket rows have a context menu', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets');
	await page
		.getByRole('link', { name: /Progress bar does not refresh/ })
		.click({ button: 'right' });
	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitem', { name: 'Copy reference' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await page
		.getByRole('link', { name: /Progress bar does not refresh/ })
		.click({ button: 'right' });
	await page.getByRole('menuitem', { name: /^Open SPL-1/ }).click();
	await expect(page).toHaveURL(/\/p\/spl\/tickets\/1$/);
});

test('checkboxes use the custom style and support indeterminate', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets');
	const all = page.getByLabel('Select all');
	expect(await all.evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
	await page.getByLabel('Select SPL-2').check();
	expect(
		await page.getByLabel(/1 selected/).evaluate((el) => (el as HTMLInputElement).indeterminate)
	).toBe(true);
	// Polled: the fill animates briefly.
	await expect
		.poll(() =>
			page.getByLabel('Select SPL-2').evaluate((el) => getComputedStyle(el).backgroundColor)
		)
		.toBe('rgb(184, 247, 121)');
});

test('no console or hydration errors', () => {
	expect(errors.filter((e) => !/status of 40[0134]/.test(e))).toEqual([]);
});
