import { drawable, regular, semiBold, textWidth, type FontFace } from './font';

/**
 * Pure SVG layout of the roadmap image: slate surfaces, a teal (or project) accent, compact
 * cards. Everything user-supplied is escaped and measured with the bundled font, so long titles
 * wrap and truncate instead of overflowing. No remote resources are ever referenced.
 */

export interface ImageCard {
	/** Ticket reference, e.g. KNS-12. */
	key: string;
	title: string;
	type: 'bug' | 'feature' | 'improvement' | 'feedback' | string;
	votes: number | null;
	release: string | null;
}

export interface ImageColumn {
	id: 'open' | 'planned' | 'in_progress' | 'completed';
	label: string;
	/** Real number of tickets (the card list may be shorter). */
	total: number;
	cards: ImageCard[];
}

export interface RoadmapImageModel {
	projectName: string;
	/** `#rrggbb` accent or null for the default teal. */
	accent: string | null;
	/** PNG bytes of the project logo, already normalised, or null. */
	logoPng: Buffer | null;
	layout: 'full' | 'compact';
	/** Pre-formatted "Updated …" text, or null to omit. */
	stamp: string | null;
	columns: ImageColumn[];
}

const W = 1200;
const PAD = 32;
const GAP = 14;
const TEAL = '#2dd4bf';
const C = {
	bg: '#0f172a',
	column: '#162033',
	columnBorder: '#273449',
	card: '#1e293b',
	cardBorder: '#334155',
	text: '#e2e8f0',
	muted: '#94a3b8',
	faint: '#64748b'
};
const COLUMN_DOT: Record<ImageColumn['id'], string> = {
	open: '#38bdf8',
	planned: '#a78bfa',
	in_progress: '#fbbf24',
	completed: '#4ade80'
};
const TYPE_STYLE: Record<string, { label: string; color: string }> = {
	bug: { label: 'Bug', color: '#f87171' },
	feature: { label: 'Feature', color: '#a78bfa' },
	improvement: { label: 'Improvement', color: '#2dd4bf' },
	feedback: { label: 'Feedback', color: '#fbbf24' }
};

export const esc = (text: string) =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

/** Splits `text` into at most `maxLines` lines no wider than `width`, ending in "…" if cut. */
export function wrapText(
	face: FontFace,
	text: string,
	size: number,
	width: number,
	maxLines: number
): string[] {
	const clean = drawable(text).replace(/\s+/g, ' ').trim();
	if (!clean) return [''];
	const fits = (s: string) => textWidth(face, s, size) <= width;
	const lines: string[] = [];
	let rest = clean;
	while (rest && lines.length < maxLines) {
		if (fits(rest)) {
			lines.push(rest);
			rest = '';
			break;
		}
		let cut = rest.length;
		while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
		// Break at a space when the line has one; otherwise split the long word.
		let at = cut;
		if (rest[cut] !== ' ') {
			const space = rest.lastIndexOf(' ', cut);
			if (space > 0) at = space;
		}
		lines.push(rest.slice(0, at).trimEnd());
		rest = rest.slice(at).trimStart();
	}
	if (rest) {
		let last = lines.pop() ?? '';
		while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
		lines.push(`${last.trimEnd()}…`);
	}
	return lines;
}

function ellipsize(face: FontFace, text: string, size: number, width: number): string {
	const clean = drawable(text);
	if (textWidth(face, clean, size) <= width) return clean;
	let s = clean;
	while (s.length > 1 && textWidth(face, `${s}…`, size) > width) s = s.slice(0, -1);
	return `${s.trimEnd()}…`;
}

const t = (
	x: number,
	y: number,
	text: string,
	opts: { size: number; fill: string; face?: FontFace; anchor?: 'start' | 'end' }
) =>
	`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${(opts.face ?? regular).family}" font-size="${opts.size}" fill="${opts.fill}"${opts.anchor === 'end' ? ' text-anchor="end"' : ''}>${esc(text)}</text>`;

interface Placed {
	svg: string;
	height: number;
}

function card(
	c: ImageCard,
	x: number,
	y: number,
	width: number,
	compact: boolean,
	accent: string
): Placed {
	const inner = width - 20;
	const titleSize = 13;
	const lineH = 17;
	const lines = wrapText(semiBold, c.title, titleSize, inner, compact ? 2 : 3);
	const meta: string[] = [];
	if (c.release) meta.push(c.release);
	const hasMeta = !compact && (c.votes !== null || meta.length > 0);
	const height = 10 + 14 + 6 + lines.length * lineH + (hasMeta ? 22 : 0) + 6;
	let svg = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="${C.card}" stroke="${C.cardBorder}"/>`;
	// Ticket key and type marker.
	const keyText = ellipsize(regular, c.key, 11, inner * 0.55);
	svg += t(x + 10, y + 20, keyText, { size: 11, fill: C.muted });
	const style = TYPE_STYLE[c.type];
	if (style) {
		const label = style.label;
		const labelW = textWidth(regular, label, 10);
		const chipW = labelW + 14;
		const cx = x + width - 10 - chipW;
		svg += `<rect x="${cx.toFixed(1)}" y="${y + 9}" width="${chipW.toFixed(1)}" height="16" rx="8" fill="${style.color}" fill-opacity="0.16"/>`;
		svg += t(cx + 7, y + 20.5, label, { size: 10, fill: style.color });
	}
	lines.forEach((line, i) => {
		svg += t(x + 10, y + 10 + 14 + 6 + 12 + i * lineH, line, {
			size: titleSize,
			fill: C.text,
			face: semiBold
		});
	});
	if (hasMeta) {
		const my = y + height - 12;
		let mx = x + 10;
		if (c.votes !== null) {
			// Little up-arrow drawn as a path (the font has no arrow glyph).
			svg += `<path d="M${mx + 4.5} ${my - 8} L${mx + 9} ${my - 2} L${mx} ${my - 2} Z" fill="${accent}"/>`;
			const v = String(c.votes);
			svg += t(mx + 14, my - 1, v, { size: 11, fill: C.text, face: semiBold });
			mx += 14 + textWidth(semiBold, v, 11) + 12;
		}
		for (const m of meta) {
			const label = ellipsize(regular, m, 11, x + width - 10 - mx);
			svg += `<rect x="${mx}" y="${my - 9}" width="8" height="8" rx="2" fill="none" stroke="${C.muted}"/>`;
			svg += t(mx + 13, my - 1, label, { size: 11, fill: C.muted });
			mx += 13 + textWidth(regular, label, 11) + 10;
		}
	}
	return { svg, height };
}

export function buildSvg(model: RoadmapImageModel): string {
	const accent = model.accent && /^#[0-9a-f]{6}$/i.test(model.accent) ? model.accent : TEAL;
	const compact = model.layout === 'compact';
	const maxCards = compact ? 15 : 10;
	const n = model.columns.length;
	const colW = (W - PAD * 2 - GAP * (n - 1)) / n;
	const cardW = colW - 20;

	// ── header ──
	const headerH = 84;
	let head = '';
	let textX = PAD;
	const logoSize = 44;
	if (model.logoPng) {
		const uri = `data:image/png;base64,${model.logoPng.toString('base64')}`;
		head += `<clipPath id="logo"><rect x="${PAD}" y="${PAD}" width="${logoSize}" height="${logoSize}" rx="10"/></clipPath>`;
		head += `<image x="${PAD}" y="${PAD}" width="${logoSize}" height="${logoSize}" href="${uri}" clip-path="url(#logo)" preserveAspectRatio="xMidYMid slice"/>`;
		textX += logoSize + 14;
	} else {
		// No logo: a monogram tile in the accent colour.
		const letter = (drawable(model.projectName).trim()[0] ?? '?').toUpperCase();
		head += `<rect x="${PAD}" y="${PAD}" width="${logoSize}" height="${logoSize}" rx="10" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-opacity="0.5"/>`;
		head += t(PAD + logoSize / 2 - textWidth(semiBold, letter, 22) / 2, PAD + 30, letter, {
			size: 22,
			fill: accent,
			face: semiBold
		});
		textX += logoSize + 14;
	}
	const stampW = model.stamp ? textWidth(regular, model.stamp, 11) : 0;
	const nameMax = W - textX - PAD - stampW - 16;
	head += t(textX, PAD + 20, ellipsize(semiBold, model.projectName, 20, nameMax), {
		size: 20,
		fill: C.text,
		face: semiBold
	});
	head += t(textX, PAD + 39, 'Roadmap', { size: 13, fill: accent, face: semiBold });
	if (model.stamp)
		head += t(W - PAD, PAD + 39, model.stamp, { size: 11, fill: C.faint, anchor: 'end' });

	// ── columns ──
	const top = PAD + headerH - 10;
	const placed = model.columns.map((col, i) => {
		const x = PAD + i * (colW + GAP);
		let y = top + 44;
		let body = '';
		const shown = col.cards.slice(0, maxCards);
		for (const c of shown) {
			const p = card(c, x + 10, y, cardW, compact, accent);
			body += p.svg;
			y += p.height + 8;
		}
		if (!shown.length) {
			body += `<rect x="${x + 10}" y="${y}" width="${cardW}" height="52" rx="8" fill="none" stroke="${C.cardBorder}" stroke-dasharray="4 4"/>`;
			body += t(x + colW / 2 - textWidth(regular, 'No tickets', 12) / 2, y + 30, 'No tickets', {
				size: 12,
				fill: C.faint
			});
			y += 60;
		}
		const more = col.total - shown.length;
		if (more > 0 && shown.length) {
			body += t(x + 12, y + 14, `+ ${more} more`, { size: 12, fill: C.muted });
			y += 24;
		}
		return { x, body, bottom: y + 2 };
	});
	const colBottom = Math.max(...placed.map((p) => p.bottom)) + 8;
	let cols = '';
	model.columns.forEach((col, i) => {
		const { x, body } = placed[i];
		cols += `<rect x="${x}" y="${top}" width="${colW}" height="${colBottom - top}" rx="12" fill="${C.column}" stroke="${C.columnBorder}"/>`;
		cols += `<circle cx="${x + 18}" cy="${top + 23}" r="4.5" fill="${COLUMN_DOT[col.id]}"/>`;
		cols += t(x + 30, top + 27, col.label, { size: 13, fill: C.text, face: semiBold });
		cols += t(x + colW - 14, top + 27, String(col.total), {
			size: 12,
			fill: C.muted,
			anchor: 'end'
		});
		cols += `<line x1="${x + 1}" y1="${top + 38}" x2="${x + colW - 1}" y2="${top + 38}" stroke="${C.columnBorder}"/>`;
		cols += body;
	});
	const height = Math.ceil(colBottom + PAD);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="${W}" height="${height}" fill="${C.bg}"/><rect x="0" y="0" width="${W}" height="3" fill="${accent}"/>${head}${cols}</svg>`;
}
