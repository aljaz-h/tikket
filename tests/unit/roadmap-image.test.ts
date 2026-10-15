import { describe, expect, it } from 'vitest';
import { drawable, regular, semiBold, textWidth } from '../../src/lib/server/roadmap-image/font';
import { buildSvg, esc, wrapText } from '../../src/lib/server/roadmap-image/svg';

describe('roadmap image layout', () => {
	it('measures text with the real font', () => {
		expect(textWidth(regular, 'iiii', 13)).toBeLessThan(textWidth(regular, 'WWWW', 13));
		expect(textWidth(semiBold, 'Roadmap', 13)).toBeGreaterThan(textWidth(regular, 'Roadmap', 13));
	});

	it('wraps long titles, breaks unbroken words and ends truncated text with an ellipsis', () => {
		const width = 200;
		const lines = wrapText(regular, 'word '.repeat(80), 13, width, 3);
		expect(lines).toHaveLength(3);
		expect(lines[2].endsWith('…')).toBe(true);
		for (const l of lines) expect(textWidth(regular, l, 13)).toBeLessThanOrEqual(width);
		const long = wrapText(regular, 'x'.repeat(300), 13, width, 2);
		expect(long).toHaveLength(2);
		for (const l of long) expect(textWidth(regular, l, 13)).toBeLessThanOrEqual(width);
		expect(wrapText(regular, 'Short title', 13, width, 3)).toEqual(['Short title']);
		expect(wrapText(regular, '   ', 13, width, 3)).toEqual(['']);
	});

	it('escapes markup and drops characters the font cannot draw', () => {
		expect(esc(`<script>"a" & 'b'</script>`)).toBe(
			'&lt;script&gt;&quot;a&quot; &amp; &apos;b&apos;&lt;/script&gt;'
		);
		expect(drawable('Žlutý kůň‮\u0000')).toBe('Žlutý kůň');
		expect(drawable('日本')).toBe('??');
	});

	it('never lets titles inject SVG', () => {
		const svg = buildSvg({
			projectName: '<b onload=x>Proj</b>',
			accent: 'red;"/><script>',
			logoPng: null,
			layout: 'compact',
			stamp: null,
			columns: [
				{
					id: 'planned',
					label: 'Planned',
					total: 1,
					cards: [
						{
							key: 'A-1',
							title: '"><image href="http://evil/x.png"/>',
							type: 'bug',
							votes: 3,
							release: null
						}
					]
				}
			]
		});
		expect(svg).not.toContain('<script');
		expect(svg).not.toContain('<b ');
		expect(svg).not.toMatch(/href="http/);
		expect(svg).toContain('&lt;b onload');
	});
});
