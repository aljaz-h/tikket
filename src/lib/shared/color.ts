/** Relative luminance (WCAG) of a #rrggbb colour. */
export function luminance(hex: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) return 0;
	const [r, g, b] = [0, 2, 4].map((i) => {
		const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text colour with the better contrast on the given background: brand charcoal or white. */
export function readableOn(hex: string): '#0d0f11' | '#ffffff' {
	const l = luminance(hex);
	// Contrast against charcoal (L≈0.005) vs. white (L=1); pick the larger ratio.
	return (l + 0.05) / 0.055 >= 1.05 / (l + 0.05) ? '#0d0f11' : '#ffffff';
}

export const DEFAULT_ACCENT = '#b8f779';
