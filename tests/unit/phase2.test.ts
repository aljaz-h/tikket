import { describe, expect, it } from 'vitest';
import { normalizeOrigin, sanitizeEnvironment, stripUrl } from '../../src/lib/shared/widget';
import { validateTemplateAnswers, type TemplateFieldDef } from '../../src/lib/shared/templates';
import {
	inverseRelation,
	storedRelation,
	wouldCreateBlockingCycle
} from '../../src/lib/shared/relations';
import { parseBulkForm } from '../../src/lib/server/services/bulk';

describe('widget origins', () => {
	it('normalises to scheme + host + port', () => {
		expect(normalizeOrigin('https://Spool.example.com/path?q=1')).toBe('https://spool.example.com');
		expect(normalizeOrigin('spool.example.com')).toBe('https://spool.example.com');
		expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
		expect(normalizeOrigin('localhost:5173')).toBe('https://localhost:5173');
		expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
	});

	it('rejects other schemes, credentials and garbage', () => {
		for (const bad of [
			'',
			'ftp://example.com',
			'javascript:alert(1)',
			'data:text/html,hi',
			'https://user:pw@example.com',
			'file:///etc/passwd',
			'x'.repeat(400)
		])
			expect(normalizeOrigin(bad), bad).toBeNull();
	});
});

describe('environment sanitising', () => {
	it('drops query strings, fragments and credentials from page URLs', () => {
		expect(stripUrl('https://a.example/settings?token=secret#frag')).toBe(
			'https://a.example/settings'
		);
		expect(stripUrl('javascript:alert(1)')).toBeUndefined();
	});

	it('keeps only known fields, clipped, and only pages on the verified origin', () => {
		const env = sanitizeEnvironment(
			{
				pageUrl: 'https://shop.example/cart?email=a@b.c',
				pageTitle: 'Cart\u0000<script>',
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
				viewportWidth: 1280,
				viewportHeight: 720,
				cookies: 'session=abc',
				localStorage: { token: 'x' }
			},
			'https://shop.example'
		);
		expect(env).toEqual({
			pageUrl: 'https://shop.example/cart',
			pageTitle: 'Cart <script>',
			browser: 'Chrome',
			browserVersion: '128.0',
			os: 'Windows',
			viewport: '1280×720',
			origin: 'https://shop.example'
		});
		expect(
			sanitizeEnvironment({ pageUrl: 'https://evil.example/x' }, 'https://shop.example')
		).toEqual({
			origin: 'https://shop.example'
		});
		expect(sanitizeEnvironment('nope')).toBeNull();
		expect(sanitizeEnvironment({ viewportWidth: -1, viewportHeight: 1e9 })).toBeNull();
	});
});

describe('template answers', () => {
	const fields: TemplateFieldDef[] = [
		{
			key: 'device',
			kind: 'select',
			label: 'Device',
			help: null,
			placeholder: null,
			required: true,
			options: ['Phone', 'Desktop']
		},
		{
			key: 'steps',
			kind: 'long_text',
			label: 'Steps',
			help: null,
			placeholder: null,
			required: false,
			options: []
		},
		{
			key: 'link',
			kind: 'url',
			label: 'Link',
			help: null,
			placeholder: null,
			required: false,
			options: []
		},
		{
			key: 'agree',
			kind: 'checkbox',
			label: 'I checked the FAQ',
			help: null,
			placeholder: null,
			required: true,
			options: []
		},
		{
			key: 'name',
			kind: 'short_text',
			label: 'Name',
			help: null,
			placeholder: null,
			required: false,
			options: []
		}
	];

	it('accepts valid answers and snapshots labels and kinds', () => {
		const r = validateTemplateAnswers(fields, {
			tpl_device: 'Phone',
			tpl_steps: '  1. open  ',
			tpl_link: 'example.com/a',
			tpl_agree: 'on'
		});
		expect(r).toEqual({
			ok: true,
			answers: [
				{ key: 'device', label: 'Device', kind: 'select', value: 'Phone' },
				{ key: 'steps', label: 'Steps', kind: 'long_text', value: '1. open' },
				{ key: 'link', label: 'Link', kind: 'url', value: 'https://example.com/a' },
				{ key: 'agree', label: 'I checked the FAQ', kind: 'checkbox', value: true }
			]
		});
	});

	it('rejects missing required answers, unknown options, bad URLs and long text', () => {
		const r = validateTemplateAnswers(fields, {
			tpl_device: 'Tablet',
			tpl_link: 'javascript:alert(1)',
			tpl_name: 'x'.repeat(301)
		});
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(Object.keys(r.errors).sort()).toEqual([
				'tpl_agree',
				'tpl_device',
				'tpl_link',
				'tpl_name'
			]);
	});
});

describe('ticket relationships', () => {
	it('detects blocking cycles of any length', () => {
		const edges = [
			{ source: 1, target: 2 },
			{ source: 2, target: 3 }
		];
		expect(wouldCreateBlockingCycle(edges, 3, 1)).toBe(true);
		expect(wouldCreateBlockingCycle(edges, 2, 1)).toBe(true);
		expect(wouldCreateBlockingCycle(edges, 1, 3)).toBe(false);
		expect(wouldCreateBlockingCycle(edges, 4, 1)).toBe(false);
		expect(wouldCreateBlockingCycle(edges, 5, 5)).toBe(true);
	});

	it('stores "blocked by" as the inverse "blocks" and "related" undirected', () => {
		expect(storedRelation(7, 3, 'blocked_by')).toEqual({ source: 3, target: 7, kind: 'blocks' });
		expect(storedRelation(7, 3, 'blocks')).toEqual({ source: 7, target: 3, kind: 'blocks' });
		expect(storedRelation(7, 3, 'relates')).toEqual({ source: 3, target: 7, kind: 'relates' });
		expect(inverseRelation('blocks')).toBe('blocked_by');
		expect(inverseRelation('relates')).toBe('relates');
	});
});

describe('bulk form parsing', () => {
	const form = (change: string, tickets: (string | number)[]) => {
		const f = new FormData();
		f.set('change', change);
		for (const t of tickets) f.append('ticket', String(t));
		return f;
	};

	it('parses each operation and de-duplicates ticket numbers', () => {
		expect(parseBulkForm(form('status:completed', [1, 2, 2]))).toEqual({
			op: { kind: 'status', status: 'completed' },
			numbers: [1, 2]
		});
		expect(parseBulkForm(form('assign:none', [3])).op).toEqual({
			kind: 'assign',
			assigneeId: null
		});
		expect(parseBulkForm(form('removeLabel:4', [3])).op).toEqual({
			kind: 'removeLabel',
			labelId: 4
		});
	});

	it('rejects invalid input', () => {
		expect(() => parseBulkForm(form('status:completed', []))).toThrow(/at least one/);
		expect(() => parseBulkForm(form('status:duplicate', [1]))).toThrow(/one at a time/);
		expect(() => parseBulkForm(form('status:bogus', [1]))).toThrow();
		expect(() => parseBulkForm(form('delete:1', [1]))).toThrow();
		expect(() =>
			parseBulkForm(
				form(
					'priority:high',
					Array.from({ length: 101 }, (_, i) => i + 1)
				)
			)
		).toThrow(/at most/);
	});
});

describe('accent colour contrast', () => {
	it('picks charcoal text on light accents and white on dark ones', async () => {
		const { readableOn, luminance } = await import('../../src/lib/shared/color');
		expect(readableOn('#b8f779')).toBe('#0d0f11');
		expect(readableOn('#ffffff')).toBe('#0d0f11');
		expect(readableOn('#1d4ed8')).toBe('#ffffff');
		expect(readableOn('#000000')).toBe('#ffffff');
		expect(luminance('nope')).toBe(0);
	});
});
