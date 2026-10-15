import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import regularData from '../fonts/Inter-Regular.otf?inline';
import semiBoldData from '../fonts/Inter-SemiBold.otf?inline';

/**
 * Fonts for the roadmap image. Containers have no system fonts, so Inter (SIL Open Font
 * License, see ../fonts/LICENSE.txt) ships inside the server bundle. The renderer (librsvg, via
 * sharp) only ever sees these two files: they are written to a private temp directory once and
 * fontconfig is pointed at it, so output is identical on every host.
 *
 * Text is measured with the real glyph advances (cmap + hmtx), which lets cards wrap and
 * truncate long titles accurately without a layout engine.
 */

export interface FontFace {
	/** Family name used in the SVG. */
	family: string;
	unitsPerEm: number;
	has(codePoint: number): boolean;
	advance(codePoint: number): number;
}

const fromDataUrl = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const REGULAR = fromDataUrl(regularData);
const SEMIBOLD = fromDataUrl(semiBoldData);

function parse(buf: Buffer, family: string): FontFace {
	const tables = new Map<string, number>();
	const count = buf.readUInt16BE(4);
	for (let i = 0; i < count; i++)
		tables.set(buf.toString('latin1', 12 + i * 16, 16 + i * 16), buf.readUInt32BE(20 + i * 16));
	const table = (name: string) => {
		const offset = tables.get(name);
		if (offset === undefined) throw new Error(`Font table ${name} missing`);
		return offset;
	};
	const head = table('head');
	const unitsPerEm = buf.readUInt16BE(head + 18);
	const hhea = table('hhea');
	const metricCount = buf.readUInt16BE(hhea + 34);
	const hmtx = table('hmtx');
	const advanceOfGlyph = (g: number) => buf.readUInt16BE(hmtx + 4 * Math.min(g, metricCount - 1));

	// Unicode cmap: prefer format 12 (full range), fall back to format 4 (BMP).
	const cmap = table('cmap');
	const subtables = buf.readUInt16BE(cmap + 2);
	let f4 = -1;
	let f12 = -1;
	for (let i = 0; i < subtables; i++) {
		const platform = buf.readUInt16BE(cmap + 4 + i * 8);
		const encoding = buf.readUInt16BE(cmap + 6 + i * 8);
		const offset = cmap + buf.readUInt32BE(cmap + 8 + i * 8);
		const format = buf.readUInt16BE(offset);
		const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
		if (!unicode) continue;
		if (format === 12) f12 = offset;
		else if (format === 4 && f4 < 0) f4 = offset;
	}
	const glyphCache = new Map<number, number>();
	const glyph = (cp: number): number => {
		const hit = glyphCache.get(cp);
		if (hit !== undefined) return hit;
		let g = 0;
		if (f12 >= 0) {
			const groups = buf.readUInt32BE(f12 + 12);
			for (let i = 0; i < groups; i++) {
				const o = f12 + 16 + i * 12;
				const start = buf.readUInt32BE(o);
				const end = buf.readUInt32BE(o + 4);
				if (cp >= start && cp <= end) {
					g = buf.readUInt32BE(o + 8) + (cp - start);
					break;
				}
			}
		} else if (f4 >= 0 && cp <= 0xffff) {
			const segX2 = buf.readUInt16BE(f4 + 6);
			const ends = f4 + 14;
			const starts = ends + segX2 + 2;
			const deltas = starts + segX2;
			const ranges = deltas + segX2;
			for (let s = 0; s < segX2; s += 2) {
				if (cp > buf.readUInt16BE(ends + s)) continue;
				const start = buf.readUInt16BE(starts + s);
				if (cp < start) break;
				const delta = buf.readInt16BE(deltas + s);
				const rangeOffset = buf.readUInt16BE(ranges + s);
				if (rangeOffset === 0) g = (cp + delta) & 0xffff;
				else {
					const gi = buf.readUInt16BE(ranges + s + rangeOffset + (cp - start) * 2);
					g = gi === 0 ? 0 : (gi + delta) & 0xffff;
				}
				break;
			}
		}
		glyphCache.set(cp, g);
		return g;
	};
	return {
		family,
		unitsPerEm,
		has: (cp) => glyph(cp) !== 0,
		advance: (cp) => advanceOfGlyph(glyph(cp))
	};
}

export const regular = parse(REGULAR, 'Inter');
// The SemiBold file registers itself as its own family.
export const semiBold = parse(SEMIBOLD, 'Inter SemiBold');

/** Width of `text` in px at `size` (kerning ignored; a 1.5 % margin keeps it conservative). */
export function textWidth(face: FontFace, text: string, size: number): number {
	let units = 0;
	for (const ch of text) units += face.advance(ch.codePointAt(0)!);
	return (units / face.unitsPerEm) * size * 1.015;
}

/** Replaces characters the bundled font cannot draw, so no empty "tofu" boxes appear. */
export function drawable(text: string): string {
	let out = '';
	for (const ch of text.normalize('NFC')) {
		const cp = ch.codePointAt(0)!;
		if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x200b && cp <= 0x200f)) continue;
		if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff) continue;
		out += regular.has(cp) ? ch : '?';
	}
	return out;
}

let installed = false;
/** Makes the bundled fonts the only fonts librsvg can see. Safe to call repeatedly. */
export function ensureFonts() {
	if (installed) return;
	const hash = crypto
		.createHash('sha1')
		.update(REGULAR)
		.update(SEMIBOLD)
		.digest('hex')
		.slice(0, 12);
	const dir = path.join(os.tmpdir(), `tikket-fonts-${hash}`);
	const conf = path.join(dir, 'fonts.conf');
	if (!fs.existsSync(conf)) {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		fs.writeFileSync(path.join(dir, 'Inter-Regular.otf'), REGULAR);
		fs.writeFileSync(path.join(dir, 'Inter-SemiBold.otf'), SEMIBOLD);
		const tmp = `${conf}.${process.pid}.tmp`;
		fs.writeFileSync(
			tmp,
			`<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${dir}</dir><cachedir>${path.join(dir, 'cache')}</cachedir></fontconfig>\n`
		);
		fs.renameSync(tmp, conf);
	}
	process.env.FONTCONFIG_FILE = conf;
	installed = true;
}
