import { expect, test } from '@playwright/test';
import { ADMIN, goto, login } from './fixtures';

// Adding tickets to a milestone or release by choosing them from a list (no ticket numbers needed).
test.describe.configure({ mode: 'serial' });

test('choose tickets for a milestone from a searchable list', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/milestones');
	await page
		.getByRole('link', { name: /Improve Mobile Experience/ })
		.first()
		.click();
	await page.waitForURL(/\/milestones\/\d+$/);
	await page.getByRole('button', { name: 'Choose tickets…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add tickets to this milestone' });
	await expect(dialog).toBeVisible();
	// Tickets already in the milestone are not offered.
	await expect(dialog.getByRole('listitem').filter({ hasText: 'SPL-3' })).toHaveCount(0);
	await dialog.getByRole('textbox', { name: 'Search tickets' }).fill('webhook');
	const row = dialog.getByRole('listitem').filter({ hasText: 'Webhook smoke test' });
	await expect(row).toHaveCount(1);
	await row.getByRole('checkbox').check();
	await expect(dialog.getByText('1 selected')).toBeVisible();
	await dialog.getByRole('button', { name: 'Add 1 ticket' }).click();
	await expect(page.getByText('Tickets added').first()).toBeVisible();
	await expect(page.getByRole('link', { name: /Webhook smoke test/ })).toBeVisible();
	// It is no longer on offer.
	await page.getByRole('button', { name: 'Choose tickets…' }).click();
	await page.getByRole('textbox', { name: 'Search tickets' }).fill('webhook');
	await expect(page.getByText('No tickets match your search.')).toBeVisible();
});

test('the same picker works on a release', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/releases');
	await page
		.getByRole('link', { name: /v0\.16\.0/ })
		.first()
		.click();
	await page.waitForURL(/\/releases\/\d+$/);
	await page.getByRole('button', { name: 'Choose tickets…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add tickets to this release' });
	await dialog.getByRole('button', { name: 'Select all shown' }).click();
	await dialog.getByRole('button', { name: /^Add \d+ tickets?$/ }).click();
	await expect(page.getByText('Tickets added').first()).toBeVisible();
});

test('choose people to add to a project from a list', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/rmx/settings/members');
	await page.getByRole('button', { name: 'Choose people…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add people to this project' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Search people' }).fill('otto');
	const row = dialog.getByRole('listitem').filter({ hasText: '@otto' });
	await expect(row).toHaveCount(1);
	await expect(dialog.getByRole('listitem').filter({ hasText: '@mia' })).toHaveCount(0);
	await row.getByRole('checkbox').check();
	await dialog.getByRole('button', { name: 'Add 1 person' }).click();
	await expect(page.getByText('Members added').first()).toBeVisible();
	await expect(page.getByText('@otto').first()).toBeVisible();
	// Already a member: no longer offered.
	await page.getByRole('button', { name: 'Choose people…' }).click();
	await page.getByRole('textbox', { name: 'Search people' }).fill('otto');
	await expect(page.getByText('Nobody matches your search.')).toBeVisible();
});
