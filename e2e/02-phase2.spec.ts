import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ADMIN, MEMBER, goto, hydrated, login, pngBuffer, typeInEditor } from './fixtures';

// Runs after 01-core.spec.ts against the same server: the workspace, the SPL project, Ada (owner)
// and Mia (member) already exist; SPL-1 is completed and SPL-2 is open.
test.describe.configure({ mode: 'serial' });

const HOST = 'http://127.0.0.1:4300';
const consoleErrors: string[] = [];
function trackConsole(page: Page) {
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(`${page.url()}: ${msg.text()}`);
	});
	page.on('pageerror', (err) => consoleErrors.push(`${page.url()}: ${err.message}`));
}
test.beforeEach(({ page }) => trackConsole(page));

test('widget: owner enables it for one website', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/widget');
	await page.getByLabel('Allowed websites').fill(`${HOST}\nnot a url ftp://x`);
	await page.getByRole('switch', { name: /Enable the widget/ }).click();
	await page.getByRole('button', { name: 'Save widget settings' }).click();
	await expect(page.getByText(/not a valid origin|Invalid/i).first()).toBeVisible();
	await page.getByLabel('Allowed websites').fill(HOST);
	await page.getByRole('button', { name: 'Save widget settings' }).click();
	await expect(page.getByText('Widget settings saved')).toBeVisible();
	await expect(page.getByText('Widget enabled')).toBeVisible();
	await expect(page.getByText(/<script src="http:\/\/localhost:4173\/widget\.js"/)).toBeVisible();
});

test('widget: only allowed origins get the configuration or may frame the form', async ({
	request
}) => {
	const ok = await request.get('/api/widget/SPL/config', { headers: { origin: HOST } });
	expect(ok.status()).toBe(200);
	expect(ok.headers()['access-control-allow-origin']).toBe(HOST);
	const evil = await request.get('/api/widget/SPL/config', {
		headers: { origin: 'http://evil.example' }
	});
	expect(evil.status()).toBe(404);
	expect(evil.headers()['access-control-allow-origin']).toBeUndefined();

	const embed = await request.get(`/embed/SPL?host=${encodeURIComponent(HOST)}`);
	const csp = embed.headers()['content-security-policy'];
	expect(csp).toContain(`frame-ancestors 'self' ${HOST}`);
	expect(embed.headers()['x-frame-options']).toBeUndefined();
	// The rest of Tikket still refuses to be framed.
	const app = await request.get('/login');
	expect(app.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
	// Widget APIs ignore cookies and require the bearer token.
	const me = await request.get('/api/widget/SPL/me');
	expect(me.status()).toBe(401);
	expect(
		(await request.get('/api/widget/NOPE/config', { headers: { origin: HOST } })).status()
	).toBe(404);
});

test('widget: a visitor reports a bug from the customer website', async ({ page, context }) => {
	await page.goto(`${HOST}/shows/42?session=secret-token#private`);
	const launcher = page.getByRole('button', { name: 'Feedback' });
	await expect(launcher).toBeVisible();
	await launcher.click();
	const frame = page.frameLocator('iframe[title="Send feedback"]');
	await frame.locator('html[data-hydrated]').waitFor({ state: 'attached' });

	await frame.getByLabel('Title').fill('Play button overlaps subtitles');
	await frame
		.getByLabel(/What happened/)
		.fill('On the show page the play button covers the subtitles.');
	// Context is shown for review before sending – without the query string or fragment.
	await frame.getByText('Review what is sent').click();
	await expect(frame.getByText(`${HOST}/shows/42`, { exact: true })).toBeVisible();
	await expect(frame.getByText('secret-token')).toHaveCount(0);
	await expect(frame.getByText('do-not-collect')).toHaveCount(0);

	await page.waitForTimeout(1600); // honour the minimum fill time used against bots
	const popupPromise = context.waitForEvent('page');
	await frame.getByRole('button', { name: /Sign in & send/ }).click();
	const popup = await popupPromise;
	await popup.waitForSelector('html[data-hydrated]');
	await popup.getByLabel('Username or email').fill(MEMBER.username);
	await popup.getByLabel('Password').fill(MEMBER.password);
	await popup.getByRole('button', { name: 'Sign in' }).click();
	await expect(
		popup.getByRole('heading', { name: /Allow feedback from 127\.0\.0\.1/ })
	).toBeVisible();
	await popup.getByRole('button', { name: 'Allow and continue' }).click();

	await expect(frame.getByRole('heading', { name: 'Thanks for your feedback!' })).toBeVisible();
	await expect(frame.getByText(/SPL-3/)).toBeVisible();
	// The token lives in the iframe, never on the host page.
	const hostStorage = await page.evaluate(() => JSON.stringify(localStorage));
	expect(hostStorage).not.toContain('tikket');
});

test('widget: spoofed messages from the wrong origin are ignored', async ({ page }) => {
	// Open the embed page directly: its parent is itself, on Tikket's origin – not the allowed host.
	await goto(page, `/embed/SPL?host=${encodeURIComponent(HOST)}`);
	await page.evaluate(() =>
		window.postMessage(
			{ type: 'tikket:context', context: { pageUrl: 'https://evil.example/phish' } },
			'*'
		)
	);
	await page.evaluate(() =>
		window.postMessage(
			{ type: 'tikket:token', token: 'x'.repeat(43), expiresAt: '2999-01-01' },
			'*'
		)
	);
	await expect(page.getByText('evil.example')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Sign in & send/ })).toBeVisible();
});

test('widget ticket shows its source and unverified environment to staff', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets/3');
	await expect(page.getByText('via widget')).toBeVisible();
	await page.getByText('Environment').click();
	await expect(page.getByText(`${HOST}/shows/42`, { exact: true })).toBeVisible();
	await expect(page.getByText(/not verified/)).toBeVisible();
});

test('annotation: redaction is burned into the uploaded image', async ({ page }) => {
	await login(page, MEMBER);
	await goto(page, '/new?project=SPL');
	await page.getByText('Bug Report').click();
	await page.getByLabel('Title').fill('Account page shows wrong plan');
	await typeInEditor(page, 'What happened?', 'The plan name is outdated.');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Add screenshots' }).click();
	await (
		await chooser
	).setFiles({
		name: 'account.png',
		mimeType: 'image/png',
		buffer: await pngBuffer('#ffffff', 400, 300)
	});
	await page.getByRole('button', { name: 'Edit account.png' }).click();
	const canvas = page.getByTestId('annotation-canvas');
	const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
	await expect(canvas).toBeVisible();
	await tools.getByRole('button', { name: /Redact/ }).click();
	await expect(tools.getByRole('button', { name: /Redact/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 5 });
	await page.mouse.up();
	await expect(canvas).toHaveAttribute('aria-label', /1 annotation\b/);
	await tools.getByRole('button', { name: 'Undo' }).click();
	await expect(canvas).toHaveAttribute('aria-label', /0 annotations/);
	await tools.getByRole('button', { name: 'Redo' }).click();
	await page.getByRole('button', { name: 'Save image' }).click();
	await expect(page.getByRole('img', { name: 'account-annotated.png' })).toBeVisible();
	await page.getByRole('button', { name: 'Submit ticket' }).click();
	await expect(page).toHaveURL(/\/p\/spl\/tickets\/4/);

	const href = await page
		.getByRole('link', { name: /View account-annotated\.png/ })
		.getAttribute('href');
	const res = await page.request.get(href!);
	expect(res.status()).toBe(200);
	const { data, info } = await sharp(await res.body())
		.raw()
		.toBuffer({ resolveWithObject: true });
	const px = (x: number, y: number) => {
		const i = (y * info.width + x) * info.channels;
		return [data[i], data[i + 1], data[i + 2]];
	};
	expect(px(Math.round(info.width * 0.3), Math.round(info.height * 0.3))).toEqual([0, 0, 0]);
	expect(px(Math.round(info.width * 0.8), Math.round(info.height * 0.8))).toEqual([255, 255, 255]);
});

test('templates: owner builds a bug template that reporters must answer', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/settings/templates');
	await page.getByRole('link', { name: 'New template' }).click();
	await hydrated(page);
	await page.getByLabel(/^Name/).fill('Playback bug');
	await page.getByRole('button', { name: 'Dropdown' }).click();
	await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Which device?');
	await page.getByLabel(/^Options/).fill('Phone\nTV\nDesktop');
	await page.getByText('Required', { exact: true }).click();
	// Live preview
	await expect(page.getByRole('combobox', { name: /Which device/ })).toBeVisible();
	await page.getByRole('button', { name: 'Save template' }).click();
	await expect(page.getByText('Template saved')).toBeVisible();
	await expect(page.getByText('Playback bug')).toBeVisible();

	await login(page, MEMBER);
	await goto(page, '/new?project=SPL');
	await page.getByText('Bug Report').click();
	await page.getByLabel('Title').fill('Subtitles out of sync on TV');
	await typeInEditor(page, 'What happened?', 'Subtitles lag behind by two seconds.');
	await page.getByRole('button', { name: 'Submit ticket' }).click();
	// The required question blocks submission and receives focus.
	const device = page.getByLabel(/Which device/);
	await expect(device).toBeFocused();
	await expect(page).toHaveURL(/\/new/);
	await device.selectOption('TV');
	await page.getByRole('button', { name: 'Submit ticket' }).click();
	await expect(page).toHaveURL(/\/p\/spl\/tickets\/5/);
	await expect(page.getByLabel('Template answers')).toContainText('TV');
	await expect(page.getByText(/Answered using “Playback bug” \(version 1\)/)).toBeVisible();
});

test('internal notes are visible to staff only', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets/5');
	await page.getByRole('radio', { name: 'Internal note' }).click();
	await typeInEditor(page, 'Comment', 'Customer is on the legacy TV app – check build 4.2.');
	await page.getByRole('button', { name: 'Add note' }).click();
	await expect(page.getByRole('article', { name: /Internal note by Ada Admin/ })).toContainText(
		'legacy TV app'
	);

	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets/5');
	await expect(page.getByText('legacy TV app')).toHaveCount(0);
	await expect(page.getByRole('radio', { name: 'Internal note' })).toHaveCount(0);
	await goto(page, '/notifications');
	await expect(page.getByText('legacy TV app')).toHaveCount(0);
});

test('relationships: staff link blocking tickets', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets/4');
	await page.getByRole('button', { name: 'Link a ticket' }).click();
	await page.getByLabel('Relationship').selectOption('blocks');
	await page.getByLabel('Ticket to link').fill('SPL-5');
	await page.getByRole('button', { name: 'Link ticket', exact: true }).click();
	await expect(page.getByText('Tickets linked')).toBeVisible();
	await goto(page, '/p/spl/tickets/5');
	await expect(page.getByText('Blocked by', { exact: true })).toBeVisible();
	await expect(page.getByText(/linked this ticket: blocked by #4/)).toBeVisible();
	// The reverse link would be a cycle.
	await page.getByRole('button', { name: 'Link a ticket' }).click();
	await page.getByLabel('Relationship').selectOption('blocks');
	await page.getByLabel('Ticket to link').fill('SPL-4');
	await page.getByRole('button', { name: 'Link ticket', exact: true }).click();
	await expect(page.getByText(/already linked|cycle/)).toBeVisible();
});

test('bulk: staff change several tickets at once', async ({ page }) => {
	await login(page, ADMIN);
	await goto(page, '/p/spl/tickets');
	await page.getByLabel('Select SPL-4').check();
	await page.getByLabel('Select SPL-5').check();
	await expect(page.getByText('2 selected')).toBeVisible();
	await page.getByLabel('Bulk change').selectOption('priority:high');
	await page.getByRole('button', { name: 'Apply' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Update 2 tickets?');
	await dialog.getByRole('button', { name: 'Update tickets' }).click();
	await expect(page.getByText('Updated 2 tickets')).toBeVisible();

	// Select all → indeterminate → skipped feedback.
	await page.getByLabel('Select all').check();
	await page.getByLabel('Select SPL-5').uncheck();
	expect(
		await page.getByLabel(/selected$/).evaluate((el) => (el as HTMLInputElement).indeterminate)
	).toBe(true);
	await page.getByLabel('Select SPL-5').check();
	await page.getByLabel('Bulk change').selectOption('priority:high');
	await page.getByRole('button', { name: 'Apply' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Update tickets' }).click();
	await expect(page.getByText(/Skipped \d+ tickets?/)).toBeVisible();

	// Members never see bulk controls.
	await login(page, MEMBER);
	await goto(page, '/p/spl/tickets');
	await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);
});

test('widget on a phone fills the screen', async ({ browser }) => {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	const page = await ctx.newPage();
	trackConsole(page);
	await page.goto(`${HOST}/`);
	await page.getByRole('button', { name: 'Feedback' }).tap();
	const iframe = page.locator('iframe[title="Send feedback"]');
	await expect(iframe).toBeVisible();
	const box = (await iframe.boundingBox())!;
	expect(box.width).toBeGreaterThanOrEqual(389);
	const frame = page.frameLocator('iframe[title="Send feedback"]');
	await frame.locator('html[data-hydrated]').waitFor({ state: 'attached' });
	await frame.getByRole('button', { name: 'Close feedback' }).tap();
	await expect(iframe).toBeHidden();
	await ctx.close();
});

test('no console errors in phase 2 flows', () => {
	expect(consoleErrors.filter((e) => !/status of 40[0134]/.test(e))).toEqual([]);
});
