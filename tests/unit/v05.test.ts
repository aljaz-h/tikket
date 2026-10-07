import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
	decryptSecret,
	encryptSecret,
	encryptionAvailable,
	maskSecret,
	needsRotation,
	parseKey,
	SecretError
} from '../../src/lib/server/secrets';
import { validateEnvironment } from '../../src/lib/server/env-check';
import { csvCell } from '../../src/lib/server/services/export';
import {
	findTicketRefs,
	parseRepository,
	verifySignature
} from '../../src/lib/server/integrations/github';
import {
	discordMatches,
	discordMessage,
	discordText,
	type EventTicket
} from '../../src/lib/server/integrations/events';
import { maskUrl, parseDiscordUrl, parseWebhookUrl } from '../../src/lib/server/integrations/hooks';
import { excerpt, signPayload } from '../../src/lib/server/integrations/delivery';
import { backoffMs } from '../../src/lib/server/outbound/queue';
import { checkUrl, isAlwaysBlocked } from '../../src/lib/server/safe-fetch';
import { escapeHtml, renderEmail, truncate } from '../../src/lib/server/email/template';
import { classify } from '../../src/lib/server/email/mailer';
import { smtpFromEnv } from '../../src/lib/server/email/config';

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('hex');

afterEach(() => {
	delete process.env.ENCRYPTION_KEY;
	delete process.env.ENCRYPTION_KEY_PREVIOUS;
	delete process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS;
});

describe('secret encryption', () => {
	it('accepts only strong 32-byte keys', () => {
		expect(parseKey(KEY_A)?.length).toBe(32);
		expect(parseKey(KEY_B)?.length).toBe(32);
		expect(parseKey(crypto.randomBytes(32).toString('base64url'))?.length).toBe(32);
		for (const bad of [
			'',
			'short',
			'x'.repeat(44),
			'0'.repeat(64),
			crypto.randomBytes(16).toString('base64')
		])
			expect(parseKey(bad), bad).toBeNull();
	});

	it('refuses to store secrets without a key – never generates one silently', () => {
		expect(encryptionAvailable()).toBe(false);
		expect(() => encryptSecret('s3cret', 'test')).toThrow(SecretError);
	});

	it('round-trips, binds values to their purpose and detects tampering', () => {
		process.env.ENCRYPTION_KEY = KEY_A;
		const box = encryptSecret('hunter2', 'smtp:password');
		expect(box).not.toContain('hunter2');
		expect(box.startsWith('v1.')).toBe(true);
		expect(decryptSecret(box, 'smtp:password')).toBe('hunter2');
		expect(encryptSecret('hunter2', 'smtp:password')).not.toBe(box); // random IV
		expect(() => decryptSecret(box, 'hook:url')).toThrow(/modified or corrupted/);
		const parts = box.split('.');
		parts[3] = Buffer.from('tampered').toString('base64url');
		expect(() => decryptSecret(parts.join('.'), 'smtp:password')).toThrow(SecretError);
	});

	it('explains a wrong key and supports rotation via ENCRYPTION_KEY_PREVIOUS', () => {
		process.env.ENCRYPTION_KEY = KEY_A;
		const box = encryptSecret('token', 'github:token');
		process.env.ENCRYPTION_KEY = KEY_B;
		expect(() => decryptSecret(box, 'github:token')).toThrow(/different ENCRYPTION_KEY/);
		process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
		expect(decryptSecret(box, 'github:token')).toBe('token');
		expect(needsRotation(box)).toBe(true);
		expect(needsRotation(encryptSecret('token', 'github:token'))).toBe(false);
		delete process.env.ENCRYPTION_KEY;
		delete process.env.ENCRYPTION_KEY_PREVIOUS;
		expect(() => decryptSecret(box, 'github:token')).toThrow(/ENCRYPTION_KEY is not set/);
	});

	it('masks secrets for display', () => {
		expect(maskSecret('whsec_abcdef')).toBe('whse••••••••');
		expect(maskSecret('abc')).toBe('••••••••');
	});
});

describe('start-up validation', () => {
	const base = { NODE_ENV: 'production', ORIGIN: 'https://t.example.com' };
	it('rejects invalid encryption keys and incomplete SMTP configuration', () => {
		expect(validateEnvironment({ ...base, ENCRYPTION_KEY: KEY_A }).errors).toEqual([]);
		expect(validateEnvironment({ ...base, ENCRYPTION_KEY: 'changeme' }).errors[0]).toMatch(
			/ENCRYPTION_KEY is invalid/
		);
		expect(validateEnvironment({ ...base, ENCRYPTION_KEY_PREVIOUS: KEY_A }).errors.join()).toMatch(
			/ENCRYPTION_KEY is not/
		);
		expect(validateEnvironment({ ...base, SMTP_HOST: 'smtp.example.com' }).errors.join()).toMatch(
			/SMTP_FROM/
		);
		expect(
			validateEnvironment({
				...base,
				SMTP_HOST: 'smtp.example.com',
				SMTP_FROM: 'tikket@example.com',
				SMTP_SECURITY: 'ssl'
			}).errors.join()
		).toMatch(/SMTP_SECURITY/);
		expect(
			validateEnvironment({ ...base, OUTBOUND_ALLOW_PRIVATE_NETWORKS: 'true' }).warnings.join()
		).toMatch(/private/);
	});

	it('reads SMTP from the environment with sensible defaults', () => {
		const cfg = smtpFromEnv({
			SMTP_HOST: 'smtp.example.com',
			SMTP_FROM: 'a@example.com',
			SMTP_PASSWORD: 'pw'
		});
		expect(cfg).toMatchObject({
			source: 'env',
			port: 587,
			security: 'starttls',
			hasPassword: true
		});
		expect(cfg?.password()).toBe('pw');
		expect(smtpFromEnv({ SMTP_HOST: 'x', SMTP_SECURITY: 'tls' })?.port).toBe(465);
		expect(smtpFromEnv({})).toBeNull();
	});
});

describe('CSV export', () => {
	it('neutralises spreadsheet formulas and quotes per RFC 4180', () => {
		expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
		for (const v of ['+1+2', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])
			expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
		expect(csvCell('a, b')).toBe('"a, b"');
		expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
		expect(csvCell(null)).toBe('');
		expect(csvCell(42)).toBe('42');
		expect(csvCell('plain')).toBe('plain');
	});
});

describe('GitHub', () => {
	it('detects only this project’s ticket keys as whole words', () => {
		expect(findTicketRefs('fix: progress reset (SPL-42), see spl-7 and SPL-42', 'SPL')).toEqual([
			42, 7
		]);
		expect(findTicketRefs('XSPL-1 SPL-2x OTHER-3 SPL-', 'SPL')).toEqual([]);
		expect(findTicketRefs('Fixes [SPL-9]: done', 'SPL')).toEqual([9]);
		expect(
			findTicketRefs(Array.from({ length: 50 }, (_, i) => `SPL-${i + 1}`).join(' '), 'SPL')
		).toHaveLength(20);
	});

	it('parses repositories', () => {
		expect(parseRepository('aljaz-h/spool-tracker')).toEqual({
			owner: 'aljaz-h',
			repo: 'spool-tracker'
		});
		expect(parseRepository('https://github.com/aljaz-h/spool-tracker.git')).toEqual({
			owner: 'aljaz-h',
			repo: 'spool-tracker'
		});
		for (const bad of ['spool', 'a/b/c', '../x', 'a/..', 'https://evil.com/a/b', '-x/y'])
			expect(() => parseRepository(bad), bad).toThrow();
	});

	it('verifies webhook signatures in constant time', () => {
		const body = Buffer.from('{"zen":"ok"}');
		const sig = `sha256=${crypto.createHmac('sha256', 'secret').update(body).digest('hex')}`;
		expect(verifySignature('secret', body, sig)).toBe(true);
		expect(verifySignature('other', body, sig)).toBe(false);
		expect(verifySignature('secret', Buffer.from('{"zen":"no"}'), sig)).toBe(false);
		expect(verifySignature('secret', body, null)).toBe(false);
		expect(verifySignature('secret', body, sig.replace('sha256=', 'sha1='))).toBe(false);
	});
});

describe('Discord', () => {
	const ticket: EventTicket = {
		id: 1,
		key: 'SPL-123',
		number: 123,
		title: 'Playback progress resets after refresh',
		type: 'bug',
		status: 'open',
		priority: 'medium',
		url: 'https://t.example.com/p/spl/tickets/123',
		description: 'x'.repeat(5000),
		reporter: { username: 'aljaz', name: '@everyone aljaz' },
		assignee: null,
		created_at: '',
		updated_at: '',
		completed_at: null
	};

	it('accepts only Discord webhook URLs and masks them', () => {
		const url =
			'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-123';
		expect(parseDiscordUrl(url)).toBe(url);
		expect(maskUrl('discord', url)).toBe('discord.com/api/webhooks/1234…/••••••••');
		expect(maskUrl('discord', url)).not.toContain('abcdef');
		for (const bad of [
			'http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
			'https://evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
			'https://discord.com.evil.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz',
			'https://discord.com/api/webhooks/1/x'
		])
			expect(() => parseDiscordUrl(bad), bad).toThrow();
	});

	it('maps events to subscriptions', () => {
		expect(discordMatches('ticket.created', { ticket })).toEqual(['new_ticket', 'new_bug']);
		expect(
			discordMatches('ticket.created', {
				ticket: { ...ticket, type: 'feature', priority: 'critical' }
			})
		).toEqual(['new_ticket', 'new_feature', 'high_priority']);
		expect(discordMatches('ticket.updated', { priority: { from: 'low', to: 'high' } })).toEqual([
			'high_priority'
		]);
		expect(
			discordMatches('ticket.updated', { priority: { from: 'high', to: 'critical' } })
		).toEqual([]);
		expect(discordMatches('ticket.assigned', { ticket })).toEqual([]);
	});

	it('builds compact embeds with escaped, truncated text and no mentions', () => {
		const msg = discordMessage({ key: 'SPL', name: 'Spool' }, 'ticket.created', {
			ticket: { ...ticket, description: `**bold** [phish](https://evil) @here ${'y'.repeat(800)}` }
		});
		expect(msg.allowed_mentions).toEqual({ parse: [] });
		const embed = msg.embeds[0];
		expect(embed.author.name).toBe('Tikket — New bug report');
		expect(embed.title).toBe('SPL-123 · Playback progress resets after refresh');
		expect(embed.description!.length).toBeLessThan(400);
		expect(embed.description).toContain('\\*\\*bold\\*\\*');
		expect(embed.description).toContain('\\[phish\\]\\(https://evil\\)');
		expect(embed.description).toContain('@​here');
		expect(embed.fields.find((f) => f.name === 'Reporter')?.value).toBe('@​everyone aljaz');
		expect(discordText('a\u0000b\nc', 10)).toBe('ab c');
	});
});

describe('webhooks', () => {
	it('signs timestamp + body with HMAC-SHA256', () => {
		const expected = crypto
			.createHmac('sha256', 'whsec_x')
			.update('1700000000.{"a":1}')
			.digest('hex');
		expect(signPayload('whsec_x', 1700000000, '{"a":1}')).toBe(expected);
	});

	it('validates endpoints with the SSRF policy', () => {
		expect(parseWebhookUrl('https://hooks.example.com:8443/in?token=abc')).toBe(
			'https://hooks.example.com:8443/in?token=abc'
		);
		expect(maskUrl('webhook', 'https://hooks.example.com:8443/in?token=abc')).toBe(
			'https://hooks.example.com:8443/in?…'
		);
		for (const bad of [
			'http://127.0.0.1/x',
			'http://localhost:3000/',
			'http://10.0.0.5/',
			'http://169.254.169.254/latest/meta-data',
			'http://[::1]/',
			'ftp://example.com/',
			'http://user:pw@example.com/'
		])
			expect(() => parseWebhookUrl(bad), bad).toThrow();
	});

	it('allows private destinations only with the explicit opt-in – never metadata services', () => {
		process.env.OUTBOUND_ALLOW_PRIVATE_NETWORKS = 'true';
		expect(parseWebhookUrl('http://10.0.0.5:9000/hook')).toBe('http://10.0.0.5:9000/hook');
		expect(parseWebhookUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
		expect(() => parseWebhookUrl('http://169.254.169.254/')).toThrow();
		expect(() => checkUrl('http://metadata.google.internal/', { allowPrivate: true })).toThrow();
		for (const ip of [
			'169.254.169.254',
			'0.0.0.0',
			'::',
			'fe80::1',
			'::ffff:169.254.169.254',
			'fd00:ec2::254'
		])
			expect(isAlwaysBlocked(ip), ip).toBe(true);
		expect(isAlwaysBlocked('10.0.0.1')).toBe(false);
	});

	it('keeps error excerpts short and printable', () => {
		expect(excerpt(`a\u0000b${'c'.repeat(500)}`).length).toBeLessThanOrEqual(200);
		expect(excerpt('x\n\ty')).toBe('x y');
	});
});

describe('outbound queue', () => {
	it('backs off exponentially with jitter and a cap', () => {
		const mid = () => 0.5;
		expect(backoffMs(1, mid)).toBe(30_000);
		expect(backoffMs(2, mid)).toBe(60_000);
		expect(backoffMs(3, mid)).toBe(120_000);
		expect(backoffMs(20, mid)).toBe(3_600_000);
		expect(backoffMs(1, () => 0)).toBe(24_000);
		expect(backoffMs(1, () => 1)).toBe(36_000);
	});
});

describe('email', () => {
	it('escapes user content and offers a plain-text alternative without remote images', () => {
		const { html, text } = renderEmail({
			heading: '<script>alert(1)</script>',
			paragraphs: ['Tom & "Jerry"'],
			quote: '<img src=x onerror=alert(1)>',
			details: [['Status', 'Open']],
			action: { label: 'View', url: 'https://t.example.com/p/spl/tickets/1' }
		});
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('Tom &amp; &quot;Jerry&quot;');
		expect(html).not.toMatch(/src=["']?https?:/); // no remote images or tracking pixels
		expect(text).toContain('<script>alert(1)</script>');
		expect(text).toContain('View: https://t.example.com/p/spl/tickets/1');
		expect(text).toContain('Status: Open');
		// javascript: links are dropped
		expect(
			renderEmail({ heading: 'x', action: { label: 'Go', url: 'javascript:alert(1)' } }).html
		).not.toContain('javascript:');
		expect(escapeHtml(`'`)).toBe('&#39;');
		expect(truncate('one two three four', 10)).toBe('one two…');
	});

	it('classifies SMTP failures for retries', () => {
		expect(classify({ code: 'ETIMEDOUT' }).retryable).toBe(true);
		expect(classify({ code: 'ECONNECTION' }).retryable).toBe(true);
		expect(classify({ responseCode: 421 }).retryable).toBe(true);
		expect(classify({ responseCode: 550 }).retryable).toBe(false);
		expect(classify({ code: 'EAUTH' }).retryable).toBe(false);
		expect(classify({ code: 'ESOCKET', message: 'self-signed certificate' }).retryable).toBe(false);
		expect(classify({ code: 'EAUTH', message: 'secret password' }).message).not.toContain('secret');
	});
});
