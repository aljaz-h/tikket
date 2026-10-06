import { describe, expect, it } from 'vitest';
import { extractMentions, linkify, safeHttpUrl } from '../../src/lib/shared/text';
import {
	htmlToText,
	normaliseRichInput,
	plainTextToHtml,
	sanitizeRichText
} from '../../src/lib/server/sanitize';
import {
	activeFilterCount,
	filtersToParams,
	parseTicketFilters,
	toFtsQuery
} from '../../src/lib/shared/filters';

describe('safeHttpUrl', () => {
	it('accepts only http(s) URLs without credentials', () => {
		expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
		expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
		expect(safeHttpUrl('data:text/html,hi')).toBeNull();
		expect(safeHttpUrl('https://user:pw@example.com')).toBeNull();
		expect(safeHttpUrl('not a url')).toBeNull();
	});
});

describe('linkify', () => {
	it('splits text into safe link segments', () => {
		const segs = linkify('See https://example.com/x. Thanks');
		expect(segs).toEqual([
			{ type: 'text', value: 'See ' },
			{ type: 'link', value: 'https://example.com/x', href: 'https://example.com/x' },
			{ type: 'text', value: '. Thanks' }
		]);
	});
});

describe('extractMentions', () => {
	it('finds unique @usernames but ignores emails', () => {
		expect(extractMentions('Hi @Ada and @bob. Mail ada@example.com, @ada again')).toEqual([
			'ada',
			'bob'
		]);
	});
});

describe('sanitizeRichText', () => {
	it('removes scripts, event handlers and unsafe links', () => {
		const out = sanitizeRichText(
			'<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a></p><iframe src="https://evil"></iframe>'
		);
		expect(out).not.toMatch(/script|onclick|onerror|img|iframe|javascript/i);
		expect(out).toContain(
			'<a href="https://ok.example/" rel="noopener noreferrer nofollow ugc" target="_blank">ok</a>'
		);
		expect(out).toContain('<a>bad</a>');
	});
	it('keeps the supported formatting', () => {
		const html =
			'<h2>T</h2><p><strong>b</strong> <em>i</em> <code>c</code></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote><p>q</p></blockquote><pre><code>x</code></pre>';
		expect(sanitizeRichText(html)).toBe(html);
	});
	it('downgrades h1 and strips style attributes', () => {
		expect(sanitizeRichText('<h1 style="color:red">Big</h1>')).toBe('<h2>Big</h2>');
	});
	it('returns an empty string for empty documents', () => {
		expect(sanitizeRichText('<p></p><p> </p>')).toBe('');
	});
});

describe('plain text fallback', () => {
	it('escapes HTML and links URLs', () => {
		const html = plainTextToHtml('<b>x</b>\n\nVisit https://example.com');
		expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(html).toContain('<a href="https://example.com/"');
	});
	it('produces search text', () => {
		const { text } = normaliseRichInput(
			'<p>Hello <strong>world</strong></p><ul><li>one</li></ul>',
			'html'
		);
		expect(text).toBe('Hello world\n• one');
		expect(htmlToText('a &amp; b')).toBe('a & b');
	});
});

describe('ticket filters', () => {
	it('parses and validates query parameters', () => {
		const f = parseTicketFilters(
			new URLSearchParams(
				'status=open&status=bogus&type=bug,feature&sort=votes&page=3&label=2&createdFrom=2026-01-01&createdTo=nope'
			)
		);
		expect(f.status).toEqual(['open']);
		expect(f.type).toEqual(['bug', 'feature']);
		expect(f.sort).toBe('votes');
		expect(f.page).toBe(3);
		expect(f.labels).toEqual([2]);
		expect(f.createdFrom).toBe('2026-01-01');
		expect(f.createdTo).toBe('');
		expect(activeFilterCount(f)).toBe(5);
	});
	it('round-trips through URL parameters', () => {
		const f = parseTicketFilters(
			new URLSearchParams('q=crash&status=open&priority=high&sort=newest')
		);
		expect(parseTicketFilters(filtersToParams(f))).toEqual(f);
	});
	it('builds injection-safe FTS queries', () => {
		expect(toFtsQuery('progress "bar" OR *')).toBe('"progress"* "bar"* "or"*');
		expect(toFtsQuery('The progress is not updating', 'any')).toBe('"progress"* OR "updating"*');
		expect(toFtsQuery('!!!')).toBeNull();
	});
});
