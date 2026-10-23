// Deployment checks executed through a TLS-terminating reverse proxy.
// Usage: node tests/deployment/check.mjs <full|verify> <proxy-name>
// Expects the proxy on https://127.0.0.1:8443 serving the host name tikket.test (self-signed).
import https from 'node:https';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const [mode = 'full', proxyName = 'proxy'] = process.argv.slice(2);
const ORIGIN = 'https://tikket.test:8443';
const ADMIN = { username: 'admin', password: 'deployment-test-password' };
const log = (msg) => console.log(`  [${proxyName}] ✓ ${msg}`);

/** Raw HTTPS request to the proxy (lets us forge headers a browser would not send). */
function request(method, path, { headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				host: '127.0.0.1',
				port: 8443,
				servername: 'tikket.test',
				rejectUnauthorized: false,
				method,
				path,
				headers: { host: 'tikket.test:8443', ...headers }
			},
			(res) => {
				let data = '';
				res.on('data', (c) => (data += c));
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
			}
		);
		req.on('error', reject);
		if (body) req.write(body);
		req.end();
	});
}
const form = (obj) => new URLSearchParams(obj).toString();
const formHeaders = (extra = {}) => ({
	'content-type': 'application/x-www-form-urlencoded',
	accept: 'text/html',
	origin: ORIGIN,
	...extra
});

const browser = await chromium.launch({
	executablePath: process.env.PW_CHROMIUM_PATH || undefined,
	args: ['--host-resolver-rules=MAP tikket.test 127.0.0.1', '--no-proxy-server']
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`console: ${m.text()}`));
const setCookies = [];
page.on('response', async (res) => {
	const header = (await res.headerValue('set-cookie').catch(() => null)) ?? '';
	if (header.includes('tikket_session=')) setCookies.push(header);
});
const hydrated = () => page.waitForSelector('html[data-hydrated]');

async function login() {
	await page.goto(`${ORIGIN}/login`);
	await hydrated();
	await page.fill('#identifier', ADMIN.username);
	await page.fill('#password', ADMIN.password);
	await page.click('button:has-text("Sign in")');
	await page.waitForURL(`${ORIGIN}/`);
}

try {
	// Health through the proxy.
	const health = await request('GET', '/api/health');
	assert.equal(health.status, 200, `health ${health.status} ${health.body}`);
	log('health check through proxy');

	if (mode === 'full') {
		// First-run setup over HTTPS.
		await page.goto(ORIGIN);
		await page.waitForURL(`${ORIGIN}/setup`);
		await hydrated();
		for (const [id, v] of Object.entries({
			displayName: 'Deploy Admin',
			username: ADMIN.username,
			email: 'admin@tikket.test',
			password: ADMIN.password,
			confirmPassword: ADMIN.password
		}))
			await page.fill(`#${id}`, v);
		await page.click('button:has-text("Create administrator")');
		await page.waitForURL(/welcome=1/);
		log('first-run setup form submission (CSRF origin check passed)');

		const cookie = setCookies.at(-1) ?? '';
		assert.match(cookie, /;\s*Secure/i, `session cookie not Secure: ${cookie}`);
		assert.match(cookie, /;\s*HttpOnly/i);
		assert.match(cookie, /;\s*SameSite=Lax/i);
		log('session cookie is Secure; HttpOnly; SameSite=Lax');

		// Logout and login again.
		await page.getByRole('button', { name: 'Account menu' }).first().click();
		await page.getByRole('menuitem', { name: 'Sign out' }).click();
		await page.waitForURL(`${ORIGIN}/login`);
		await login();
		log('logout and login');

		// Project + ticket with a large (~5 MB) screenshot.
		await page.goto(`${ORIGIN}/projects/new`);
		await hydrated();
		await page.fill('#name', 'Deploy');
		await page.fill('#key', 'DEP');
		await page.click('button:has-text("Create project")');
		await page.waitForURL(`${ORIGIN}/p/dep`);
		await page.goto(`${ORIGIN}/new?project=DEP`);
		await hydrated();
		await page.click('text=Bug Report');
		await page.fill('#title', 'Uploaded through the reverse proxy');
		await page.getByRole('textbox', { name: 'What happened?' }).click();
		await page.keyboard.type('Large multipart upload via TLS proxy.');
		const big = await sharp({
			create: {
				width: 1500,
				height: 1100,
				channels: 3,
				background: '#808080',
				noise: { type: 'gaussian', mean: 128, sigma: 60 }
			}
		})
			.png()
			.toBuffer();
		assert.ok(big.length > 4 * 1024 * 1024, `test image only ${big.length} bytes`);
		const chooser = page.waitForEvent('filechooser');
		await page.click('text=Add screenshots');
		await (await chooser).setFiles({ name: 'large.png', mimeType: 'image/png', buffer: big });
		await page.waitForSelector('img[alt="large.png"]', { timeout: 30_000 });
		await page.click('button:has-text("Submit ticket")');
		await page.waitForURL(/\/p\/dep\/tickets\/1/);
		log(`ticket with ${(big.length / 1024 / 1024).toFixed(1)} MB image upload`);
	} else {
		await login();
		log('login with data that existed before re-deployment');
	}

	// Data and attachment survive (verify mode) / exist (full mode).
	await page.goto(`${ORIGIN}/p/dep/tickets/1`);
	await page.waitForSelector('text=Uploaded through the reverse proxy');
	const href = await page.getAttribute('a[aria-label="View large.png"]', 'href');
	const file = await page.evaluate(async (u) => {
		const r = await fetch(u);
		return {
			status: r.status,
			type: r.headers.get('content-type'),
			size: (await r.arrayBuffer()).byteLength
		};
	}, href);
	assert.equal(file.status, 200);
	assert.equal(file.type, 'image/png');
	assert.ok(file.size > 1024 * 1024);
	log('ticket and attachment are present and served');

	// A form post (comment) through the proxy.
	await hydrated();
	const text = `Comment via ${proxyName} ${Date.now()}`;
	await page.getByRole('textbox', { name: 'Comment' }).click();
	await page.keyboard.type(text);
	await page.getByRole('button', { name: 'Comment', exact: true }).click();
	await page.waitForSelector(`text=${text}`);
	log('comment form submission');

	const sessionCookie = (await context.cookies()).find((c) => c.name === 'tikket_session');
	assert.ok(sessionCookie?.secure, 'browser stored cookie as Secure');
	const cookieHeader = `tikket_session=${sessionCookie.value}`;

	// CSRF: cross-origin form posts are rejected, even with a valid session.
	const forged = await request('POST', '/login', {
		headers: formHeaders({ origin: 'https://evil.example' }),
		body: form({ identifier: 'admin', password: 'x' })
	});
	assert.equal(forged.status, 403, `cross-origin POST returned ${forged.status}`);
	const forgedApi = await request('POST', '/api/notifications', {
		headers: {
			'content-type': 'application/json',
			origin: 'https://evil.example',
			cookie: cookieHeader
		},
		body: '{"all":true}'
	});
	assert.equal(forgedApi.status, 403);
	log('cross-origin POSTs rejected (forms and API)');

	// REST API (v0.6): bearer tokens work through the proxy; cookies alone never authenticate it.
	const created = await request('POST', '/settings/developer?/create', {
		headers: formHeaders({ cookie: cookieHeader, 'x-sveltekit-action': 'true' }),
		body: form({ name: `deploy ${proxyName}`, scopes: 'tickets:write', expiry: '7' })
	});
	const pat = /tkt_pat_[A-Za-z0-9_-]{40}/.exec(created.body)?.[0];
	assert.ok(pat, `token creation: ${created.status} ${created.body.slice(0, 200)}`);
	const apiCreate = await request('POST', '/api/v1/projects/DEP/tickets', {
		headers: {
			authorization: `Bearer ${pat}`,
			'content-type': 'application/json',
			origin: 'https://ci.example'
		},
		body: JSON.stringify({ title: `API ticket via ${proxyName}`, description: 'From CI' })
	});
	assert.equal(apiCreate.status, 201, `API create: ${apiCreate.status} ${apiCreate.body}`);
	assert.equal(JSON.parse(apiCreate.body).data.source, 'api');
	assert.ok(apiCreate.headers['x-ratelimit-limit'], 'rate limit headers pass the proxy');
	const cookieOnly = await request('GET', '/api/v1/me', { headers: { cookie: cookieHeader } });
	assert.equal(cookieOnly.status, 401);
	assert.equal(JSON.parse(cookieOnly.body).error.code, 'unauthenticated');
	assert.equal(
		(await request('GET', '/api/openapi.json')).status,
		401,
		'openapi.json is not public'
	);
	const openapi = await request('GET', '/api/openapi.json', { headers: { cookie: cookieHeader } });
	assert.equal(JSON.parse(openapi.body).servers?.[0]?.url, ORIGIN);
	log('REST API with bearer token through the proxy; session cookies are ignored');

	// Absolute links use the configured origin, never forwarded/Host headers.
	const spoofHeaders =
		proxyName === 'nginx'
			? { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' }
			: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' };
	const reset = await request('POST', '/admin/users/1?/resetLink', {
		headers: formHeaders({ cookie: cookieHeader, 'x-sveltekit-action': 'true', ...spoofHeaders }),
		body: ''
	});
	assert.equal(reset.status, 200, `reset link action: ${reset.status} ${reset.body.slice(0, 200)}`);
	const link = /(https?:\/\/[^"\\]+\/reset\/[\w-]+)/.exec(reset.body)?.[1];
	assert.ok(link?.startsWith(`${ORIGIN}/reset/`), `reset link uses wrong origin: ${link}`);
	const invite = await request('POST', '/admin/users?/invite', {
		headers: formHeaders({ cookie: cookieHeader, 'x-sveltekit-action': 'true', ...spoofHeaders }),
		body: form({ email: '', role: 'user' })
	});
	const inviteLink = /(https?:\/\/[^"\\]+\/invite\/[\w-]+)/.exec(invite.body)?.[1];
	assert.ok(
		inviteLink?.startsWith(`${ORIGIN}/invite/`),
		`invite link uses wrong origin: ${inviteLink}`
	);
	const inviteRes = await request('GET', new URL(inviteLink).pathname);
	assert.equal(inviteRes.status, 200);
	assert.match(inviteRes.body, /You’re invited/);
	log('invitation and password-reset links use ORIGIN despite spoofed Host/X-Forwarded-* headers');

	// Redirects are relative (no http:// downgrade behind TLS termination).
	const redirect = await request('GET', '/my-tickets');
	assert.equal(redirect.status, 303);
	assert.ok(!/^http:/.test(redirect.headers.location), `redirect to ${redirect.headers.location}`);
	assert.match(redirect.headers['strict-transport-security'] ?? '', /max-age/);
	log('redirects stay on HTTPS; HSTS and security headers present');

	// Client-supplied X-Forwarded-For is not trusted for rate limiting / audit.
	const spoofLogin = await request('POST', '/login', {
		headers: formHeaders({ 'x-forwarded-for': '6.6.6.6' }),
		body: form({ identifier: ADMIN.username, password: ADMIN.password })
	});
	assert.equal(spoofLogin.status, 303, `login: ${spoofLogin.status}`);
	const spoofCookie = [spoofLogin.headers['set-cookie']]
		.flat()
		.find((c) => c?.startsWith('tikket_session='));
	assert.match(spoofCookie ?? '', /Secure/i);
	const sessions = await request('GET', '/settings/security', {
		headers: { cookie: spoofCookie.split(';')[0] }
	});
	assert.equal(sessions.status, 200);
	assert.ok(!sessions.body.includes('6.6.6.6'), 'spoofed X-Forwarded-For was trusted');
	const ip = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}) · last active/.exec(
		sessions.body.replace(/<!--.*?-->/g, '')
	)?.[1];
	log(`spoofed X-Forwarded-For ignored (recorded client IP ${ip ?? 'n/a'})`);

	// Roadmap image (rendered inside the container with the bundled font, behind the proxy).
	const png = await request('GET', '/p/dep/roadmap/export.png', {
		headers: { cookie: cookieHeader }
	});
	assert.equal(png.status, 200, `roadmap export: ${png.status} ${png.body.slice(0, 200)}`);
	assert.equal(png.headers['content-type'], 'image/png');
	assert.ok(Number(png.headers['content-length']) > 4000, 'roadmap image looks empty');
	const notModified = await request('GET', '/p/dep/roadmap/export.png', {
		headers: { cookie: cookieHeader, 'if-none-match': png.headers.etag }
	});
	assert.equal(notModified.status, 304, 'roadmap ETag revalidation through the proxy');
	assert.equal((await request('GET', '/p/dep/roadmap/export.png')).status, 404);
	assert.equal((await request('GET', '/public/projects/DEP/roadmap.png')).status, 404);
	log('roadmap PNG renders in the container; ETag works; private project image is not public');

	// Private data stays private for anonymous requests.
	const anonFile = await request('GET', href);
	assert.equal(anonFile.status, 404);
	log('attachments are not served anonymously');

	assert.deepEqual(
		consoleErrors.filter((e) => !/status of 40[34]/.test(e)),
		[]
	);
	log('no browser errors');
} catch (err) {
	console.error(`  [${proxyName}] ✗ at ${page.url()}`);
	if (consoleErrors.length) console.error('  browser errors:', consoleErrors);
	throw err;
} finally {
	await browser.close();
}
