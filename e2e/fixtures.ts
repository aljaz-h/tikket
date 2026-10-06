import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

export const ADMIN = {
	username: 'ada',
	email: 'ada@example.com',
	name: 'Ada Admin',
	password: 'correct-horse-battery'
};
export const MEMBER = {
	username: 'mia',
	email: 'mia@example.com',
	name: 'Mia Member',
	password: 'member-password-1'
};
export const OUTSIDER = {
	username: 'otto',
	email: 'otto@example.com',
	name: 'Otto Outsider',
	password: 'outsider-password-1'
};

/** Waits until SvelteKit has hydrated so interactions are handled by the app. */
export async function hydrated(page: Page) {
	await page.waitForSelector('html[data-hydrated]');
}

export async function goto(page: Page, url: string) {
	await page.goto(url);
	await hydrated(page);
}

export async function login(page: Page, user: { username: string; password: string }) {
	// Start from a signed-out state (signed-in users are redirected away from /login).
	await page.context().clearCookies();
	await goto(page, '/login');
	await page.getByLabel('Username or email').fill(user.username);
	await page.getByLabel('Password').fill(user.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'));
	await hydrated(page);
}

export async function logout(page: Page) {
	await page.getByRole('button', { name: 'Account menu' }).first().click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await page.waitForURL('**/login');
}

export async function pngBuffer(color = '#e5484d', width = 320, height = 200) {
	return sharp({ create: { width, height, channels: 3, background: color } })
		.png()
		.toBuffer();
}

/** Simulates pasting an image from the clipboard. */
export async function pasteImage(page: Page, base64: string) {
	await page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const file = new File([bytes], 'clipboard.png', { type: 'image/png' });
		const dt = new DataTransfer();
		dt.items.add(file);
		const event = new ClipboardEvent('paste', {
			clipboardData: dt,
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(event);
	}, base64);
}

export async function typeInEditor(page: Page, label: string, text: string) {
	const editor = page.getByRole('textbox', { name: label });
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.type(text);
}

/** Picks an option in a Tikket select (a listbox after hydration, not a native <select>). */
export async function choose(page: Page, label: string | RegExp, option: string | RegExp) {
	// A plain select is a button that opens a listbox; a searchable one is a combobox input.
	const exact = typeof label === 'string';
	const control = page
		.getByRole('button', { name: label, exact })
		.or(page.getByRole('combobox', { name: label, exact }))
		.first();
	await control.click();
	const item = page.getByRole('option', { name: option, exact: typeof option === 'string' });
	if (!(await item.isVisible().catch(() => false))) await control.press('ArrowDown');
	await item.click();
}
