import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
	checkUrl,
	FetchError,
	isPublicAddress,
	resolvePublic,
	safeFetch
} from '../../src/lib/server/safe-fetch';
import {
	iconCandidates,
	LOGO_SIZE,
	manifestCandidates,
	normaliseLogo,
	pngFromIco
} from '../../src/lib/server/services/project-logos';

describe('SSRF guard', () => {
	it('allows only public addresses', () => {
		for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])
			expect(isPublicAddress(ip), ip).toBe(true);
		for (const ip of [
			'127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'192.168.1.1',
			'169.254.169.254', // cloud metadata
			'100.64.0.1',
			'0.0.0.0',
			'224.0.0.1',
			'255.255.255.255',
			'::1',
			'::',
			'fc00::1',
			'fd12:3456::1',
			'fe80::1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'::ffff:a9fe:a9fe',
			'64:ff9b::a00:1',
			'not-an-ip'
		])
			expect(isPublicAddress(ip), ip).toBe(false);
	});

	it('rejects unsafe URLs before any request', () => {
		for (const url of [
			'file:///etc/passwd',
			'ftp://example.com/x',
			'gopher://example.com',
			'http://localhost/',
			'http://app.localhost/',
			'http://printer.local/',
			'http://metadata.google.internal/',
			'http://127.0.0.1/',
			'http://[::1]/',
			'http://169.254.169.254/latest/meta-data/',
			'http://user:pass@example.com/',
			'http://example.com:8080/',
			'not a url'
		])
			expect(() => checkUrl(url), url).toThrow(FetchError);
		expect(checkUrl('https://example.com/a?b=1').href).toBe('https://example.com/a?b=1');
	});

	it('requires every DNS answer to be public (no rebinding via mixed answers)', async () => {
		await expect(resolvePublic('ok.test', async () => ['93.184.216.34'])).resolves.toBe(
			'93.184.216.34'
		);
		await expect(
			resolvePublic('evil.test', async () => ['93.184.216.34', '10.0.0.5'])
		).rejects.toThrow(/private/);
		await expect(resolvePublic('meta.test', async () => ['169.254.169.254'])).rejects.toThrow();
		await expect(resolvePublic('none.test', async () => [])).rejects.toThrow();
		await expect(
			resolvePublic('fail.test', async () => {
				throw new Error('ENOTFOUND');
			})
		).rejects.toThrow(/Could not find/);
	});

	it('never connects to a host that resolves to a private address', async () => {
		await expect(
			safeFetch('http://internal.example/', { maxBytes: 1000, resolve: async () => ['127.0.0.1'] })
		).rejects.toThrow(/private/);
	});
});

describe('website icon discovery', () => {
	const page = new URL('https://shop.example/products/');

	it('finds link icons, apple touch icons and the manifest; skips SVG', () => {
		const html = `<html><head>
			<link rel="icon" href="/favicon-32.png" sizes="32x32">
			<link rel='apple-touch-icon' href='/apple.png'>
			<link rel="icon" type="image/svg+xml" href="/logo.svg">
			<link rel="mask-icon" href="/mask.svg">
			<link rel="manifest" href="/site.webmanifest">
			<link rel="stylesheet" href="/a.css">
		</head></html>`;
		const { icons, manifest } = iconCandidates(html, page);
		expect(icons.map((i) => [i.url.href, i.size])).toEqual([
			['https://shop.example/favicon-32.png', 32],
			['https://shop.example/apple.png', 180]
		]);
		expect(manifest?.href).toBe('https://shop.example/site.webmanifest');
	});

	it('respects <base href> and ignores malformed links', () => {
		const html =
			'<base href="https://cdn.example/assets/"><link rel="icon" href="icon.png"><link rel="icon" href="http://[bad">';
		expect(iconCandidates(html, page).icons.map((i) => i.url.href)).toEqual([
			'https://cdn.example/assets/icon.png'
		]);
	});

	it('reads manifest icons relative to the manifest', () => {
		const icons = manifestCandidates(
			{
				icons: [
					{ src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'icons/any.svg', sizes: 'any', type: 'image/svg+xml' },
					{ nope: true }
				]
			},
			new URL('https://shop.example/app/manifest.json')
		);
		expect(icons).toEqual([{ url: new URL('https://shop.example/app/icons/192.png'), size: 192 }]);
		expect(manifestCandidates('garbage', page)).toEqual([]);
	});

	it('extracts the largest PNG from an .ico file', async () => {
		const small = await sharp({
			create: { width: 16, height: 16, channels: 4, background: '#f00' }
		})
			.png()
			.toBuffer();
		const big = await sharp({ create: { width: 48, height: 48, channels: 4, background: '#0f0' } })
			.png()
			.toBuffer();
		const header = Buffer.alloc(6 + 32);
		header.writeUInt16LE(0, 0);
		header.writeUInt16LE(1, 2);
		header.writeUInt16LE(2, 4);
		const entries = [
			{ size: 16, data: small },
			{ size: 48, data: big }
		];
		let offset = header.length;
		entries.forEach((e, i) => {
			const at = 6 + i * 16;
			header[at] = e.size;
			header[at + 1] = e.size;
			header.writeUInt32LE(e.data.length, at + 8);
			header.writeUInt32LE(offset, at + 12);
			offset += e.data.length;
		});
		const ico = Buffer.concat([header, small, big]);
		expect(pngFromIco(ico)?.equals(big)).toBe(true);
		expect(pngFromIco(Buffer.from('not an icon'))).toBeNull();
	});
});

describe('logo normalisation', () => {
	it('produces a square, metadata-free PNG and keeps the aspect ratio', async () => {
		const wide = await sharp({
			create: { width: 400, height: 100, channels: 3, background: '#b8f779' }
		})
			.jpeg()
			.withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } })
			.toBuffer();
		const png = await normaliseLogo(wide);
		const meta = await sharp(png).metadata();
		expect(meta.format).toBe('png');
		expect([meta.width, meta.height]).toEqual([LOGO_SIZE, LOGO_SIZE]);
		expect(meta.exif).toBeUndefined();
		expect(png.includes(Buffer.from('secret-gps'))).toBe(false);
		// Letterboxed: the top row is transparent, the middle is the image.
		const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
		expect(data[3]).toBe(0);
		const mid = (128 * info.width + 128) * info.channels;
		expect(data[mid + 3]).toBe(255);
	});

	it('rejects SVG, HTML and oversized input', async () => {
		await expect(
			normaliseLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
		).rejects.toThrow(/PNG, JPEG or WebP/);
		await expect(
			normaliseLogo(Buffer.from('<html><script>alert(1)</script></html>'))
		).rejects.toThrow();
		await expect(normaliseLogo(Buffer.alloc(6 * 1024 * 1024))).rejects.toThrow(/5 MB/);
	});
});
