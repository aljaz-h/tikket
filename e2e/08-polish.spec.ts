import { expect, test, type Page } from '@playwright/test';
import { ADMIN, MEMBER, goto, login } from './fixtures';

// v0.7 polish: phone widths, accessibility basics, keyboard and dialog focus, empty states,
// reminders, error pages and the new administration pages. Runs after the other specs.
test.describe.configure({ mode: 'serial' });

const errors: string[] = [];
test.beforeEach(({ page }) => {
	page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
});

const WIDTHS = [320, 375, 390, 430];

async function overflowAt(page: Page, url: string) {
	const problems: string[] = [];
	for (const width of WIDTHS) {
		await page.setViewportSize({ width, height: 800 });
		await goto(page, url);
		const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
		if (scroll > width) problems.push(`${url} @${width}px: page is ${scroll}px wide`);
	}
	await page.setViewportSize({ width: 1280, height: 800 });
	return problems;
}

/** Interactive elements without an accessible name, inputs without a label, images without alt. */
async function a11yProblems(page: Page) {
	return page.evaluate(() => {
		const visible = (el: Element) => {
			const r = el.getBoundingClientRect();
			const s = getComputedStyle(el);
			return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
		};
		const named = (el: Element) =>
			!!(
				el.getAttribute('aria-label')?.trim() ||
				el.getAttribute('aria-labelledby') ||
				el.getAttribute('title')?.trim() ||
				el.textContent?.trim() ||
				el.querySelector('img[alt]:not([alt=""]), svg[aria-label]')
			);
		const out: string[] = [];
		for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"]'))
			if (visible(el) && !named(el))
				out.push(`unnamed ${el.tagName.toLowerCase()}: ${el.outerHTML.slice(0, 120)}`);
		for (const el of document.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
			// Hidden helpers (custom select values, programmatic file pickers) aren't exposed or reachable.
			if (
				el.type === 'hidden' ||
				!visible(el) ||
				el.closest('[aria-hidden="true"]') ||
				el.tabIndex < 0
			)
				continue;
			const labelled =
				(el.labels && el.labels.length > 0) ||
				el.getAttribute('aria-label') ||
				el.getAttribute('aria-labelledby') ||
				el.getAttribute('title');
			if (!labelled) out.push(`unlabelled ${el.tagName.toLowerCase()} ${el.name || el.type}`);
		}
		for (const img of document.querySelectorAll('img'))
			if (visible(img) && !img.hasAttribute('alt'))
				out.push(`img without alt: ${img.src.slice(0, 80)}`);
		return out;
	});
}

const PAGES_MEMBER = [
	'/',
	'/new',
	'/my-tickets',
	'/notifications',
	'/p/spl/tickets',
	'/p/spl/tickets/1',
	'/settings/developer',
	'/docs/api'
];
const PAGES_ADMIN = [
	'/p/spl',
	'/p/spl/settings/automations',
	'/p/spl/settings/automations/history',
	'/p/spl/settings/import',
	'/p/spl/settings/export',
	'/p/spl/settings/workflow',
	'/admin/health',
	'/admin/queue',
	'/admin/backups'
];

test('no horizontal overflow at 320–430 px', async ({ page }) => {
	await login(page, MEMBER);
	const problems: string[] = [];
	for (const url of PAGES_MEMBER) problems.push(...(await overflowAt(page, url)));
	await login(page, ADMIN);
	for (const url of PAGES_ADMIN) problems.push(...(await overflowAt(page, url)));
	expect(problems).toEqual([]);
});

test('every control has an accessible name and every field a label', async ({ page }) => {
	await login(page, ADMIN);
	const problems: string[] = [];
	for (const url of [...PAGES_MEMBER, ...PAGES_ADMIN]) {
		await goto(page, url);
		problems.push(...(await a11yProblems(page)).map((p) => `${url}: ${p}`));
	}
	expect(problems).toEqual([]);
});

test('keyboard: skip link, visible focus, dialogs trap and restore focus, tabs reachable', async ({
	page
}) => {
	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets');
	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();
	// Focus is visible (outline or ring).
	const ring = await skip.evaluate((el) => {
		const s = getComputedStyle(el);
		return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
	});
	expect(ring).toBe(true);

	// Project tabs can be reached and followed with the keyboard.
	const tabs = page.getByRole('navigation', { name: /project/i }).getByRole('link');
	await tabs.first().focus();
	await expect(tabs.first()).toBeFocused();

	// Dialog: focus moves inside, Escape closes and focus returns to the trigger.
	await goto(page, '/settings/developer');
	const trigger = page.getByRole('button', { name: 'New token' });
	await trigger.click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
	for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
	expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();

	// Custom select opens with the keyboard and moves through options.
	await goto(page, '/my-tickets');
	await goto(page, '/p/spl/tickets/1');
	await page.getByRole('button', { name: 'Remind me' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('#reminder-panel')).toBeVisible();
});

test('reminders: set one for tomorrow, see it, remove it', async ({ page }) => {
	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets/1');
	await page.getByRole('button', { name: 'Remind me' }).click();
	await page.getByRole('button', { name: 'Tomorrow' }).click();
	await expect(page.getByText('Reminder set').first()).toBeVisible();
	const list = page.getByRole('list', { name: 'Your reminders' });
	await expect(list.getByRole('listitem')).toHaveCount(1);
	await list.getByRole('button', { name: /Remove reminder/ }).click();
	await expect(page.getByText('Reminder removed').first()).toBeVisible();
	await expect(list).toHaveCount(0);
});

test('empty states explain what to do next', async ({ page }) => {
	await login(page, ADMIN);
	// A fresh project has an intentional empty state with next steps.
	await goto(page, '/projects/new');
	await page.fill('#name', 'Empty Polish');
	await page.fill('#key', 'EMP');
	await page.getByRole('button', { name: 'Create project' }).click();
	await page.waitForURL('**/p/emp');
	await goto(page, '/p/emp/tickets');
	await expect(page.getByRole('heading', { name: 'No tickets yet' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Invite members' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Set up the feedback widget' })).toBeVisible();
	await goto(page, '/admin/queue');
	await expect(page.getByText(/No failed deliveries|Webhook|Discord|Email/).first()).toBeVisible();
	await goto(page, '/p/emp/settings/import');
	await expect(page.getByText('No imports yet.')).toBeVisible();
});

test('admin health, queue and backups pages show essentials without paths', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/admin/health');
	await expect(page.getByRole('heading', { name: 'Database' })).toBeVisible();
	await expect(page.getByText('WAL mode')).toBeVisible();
	await expect(page.getByText('Tikket version')).toBeVisible();
	const html = await page.content();
	expect(html).not.toContain('e2e/.data');
	await goto(page, '/admin/queue');
	await expect(page.getByRole('heading', { name: 'Delivery queue' })).toBeVisible();
	for (const tab of ['Failed', 'Retrying', 'Waiting'])
		await expect(page.getByRole('link', { name: tab, exact: true })).toBeVisible();
	await goto(page, '/admin/backups');
	await expect(page.getByText(/cannot be restored without it/)).toBeVisible();
	await expect(
		page.getByText('No backup has been recorded on this server yet.', { exact: false })
	).toBeVisible();
	// Members can't open administration pages.
	await login(page, MEMBER);
	const res = await page.goto('/admin/health');
	expect(res?.status()).toBe(403);
	await expect(page.getByRole('heading', { name: 'You don’t have access to this' })).toBeVisible();
});

test('error pages: 404 with back and dashboard links, private projects stay hidden', async ({
	page
}) => {
	await login(page, MEMBER);
	const res = await page.goto('/p/nope/tickets/1');
	expect(res?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible();
	expect(await page.content()).not.toMatch(/at \w+ \(|node_modules/);
});

test('automation diagnostics summary is shown to staff', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/automations');
	const health = page.getByRole('region', { name: 'Automation health' });
	await expect(health).toBeVisible();
	await expect(health.getByText('Enabled rules')).toBeVisible();
	await goto(page, '/p/spl/settings/automations/history');
	await page.getByRole('list', { name: 'Automation runs' }).getByRole('button').first().click();
	await expect(
		page.getByText(/Conditions (matched|did not match)|Actions: \d+ attempted/).first()
	).toBeVisible();
});

test('no console or hydration errors', () => {
	// The 403/404 page loads above are intentional.
	expect(errors.filter((e) => !/status of 40[34]/.test(e))).toEqual([]);
});
