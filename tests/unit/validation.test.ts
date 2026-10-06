import { describe, expect, it } from 'vitest';
import {
	accountSchema,
	projectSchema,
	ticketContextSchema,
	ticketInputSchema
} from '../../src/lib/server/validation';
import { RateLimiter } from '../../src/lib/server/auth/rate-limit';
import { cleanDisplayName, detectImageType } from '../../src/lib/server/uploads';
import { parseSize } from '../../src/lib/server/config';

describe('schemas', () => {
	it('validates accounts', () => {
		const ok = accountSchema.safeParse({
			username: 'ada_l',
			email: 'ADA@Example.com',
			displayName: 'Ada',
			password: 'long-enough-pw',
			confirmPassword: 'long-enough-pw'
		});
		expect(ok.success && ok.data.email).toBe('ada@example.com');
		const bad = accountSchema.safeParse({
			username: 'a b',
			email: 'x',
			displayName: '',
			password: 'short',
			confirmPassword: 'other'
		});
		expect(bad.success).toBe(false);
	});
	it('normalises project keys and URLs', () => {
		const r = projectSchema.safeParse({
			name: 'Spool',
			key: 'spl',
			visibility: 'public',
			url: 'spool.example.com'
		});
		expect(r.success && r.data.key).toBe('SPL');
		expect(r.success && r.data.url).toBe('https://spool.example.com/');
		expect(projectSchema.safeParse({ name: 'X', key: '1AB', visibility: 'public' }).success).toBe(
			false
		);
	});
	it('requires a title and a known ticket type', () => {
		expect(
			ticketInputSchema.safeParse({ type: 'bug', title: 'Crash on save', description: 'x' }).success
		).toBe(true);
		expect(
			ticketInputSchema.safeParse({ type: 'epic', title: 'Crash', description: 'x' }).success
		).toBe(false);
		expect(
			ticketInputSchema.safeParse({ type: 'bug', title: 'ab', description: 'x' }).success
		).toBe(false);
	});
	it('drops empty context fields and rejects unsafe affected URLs', () => {
		const r = ticketContextSchema.safeParse({
			expected: 'It works',
			steps: '',
			affectedUrl: 'example.com/x'
		});
		expect(r.success && r.data).toEqual({
			expected: 'It works',
			affectedUrl: 'https://example.com/x'
		});
		expect(ticketContextSchema.safeParse({ affectedUrl: 'javascript:alert(1)' }).success).toBe(
			false
		);
	});
});

describe('RateLimiter', () => {
	it('blocks after the limit until the window passes', () => {
		const rl = new RateLimiter(2, 1000);
		expect(rl.hit('k', 0)).toBe(0);
		expect(rl.hit('k', 1)).toBe(0);
		expect(rl.hit('k', 2)).toBeGreaterThan(0);
		expect(rl.check('k', 3)).toBeGreaterThan(0);
		expect(rl.check('k', 1001)).toBe(0);
	});
});

describe('image validation', () => {
	it('detects formats by magic bytes, not names', () => {
		const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
		const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
		const gif = new TextEncoder().encode('GIF89a......');
		const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
		const html = new TextEncoder().encode('<html><script>');
		expect(detectImageType(png)).toBe('image/png');
		expect(detectImageType(jpg)).toBe('image/jpeg');
		expect(detectImageType(gif)).toBe('image/gif');
		expect(detectImageType(webp)).toBe('image/webp');
		expect(detectImageType(html)).toBeNull();
	});
	it('sanitises display names', () => {
		expect(cleanDisplayName('../../etc/passwd', 'png')).toBe('passwd.png');
		expect(cleanDisplayName('shot<1>.png', 'png')).toBe('shot_1_.png');
	});
	it('parses size strings', () => {
		expect(parseSize('10M', 0)).toBe(10 * 1024 * 1024);
		expect(parseSize('512k', 0)).toBe(512 * 1024);
		expect(parseSize('junk', 7)).toBe(7);
	});
});
