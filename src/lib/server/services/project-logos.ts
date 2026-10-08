import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Attachment } from '../db/schema';
import { FetchError, safeFetch, type Resolver } from '../safe-fetch';
import {
	detectImageType,
	findAttachment,
	removeFiles,
	UploadError,
	writeStoredFile
} from '../uploads';
import { audit } from './audit';
import { ServiceError } from './users';

/** Logos are stored as 256 × 256 PNGs, letterboxed on a transparent background. */
export const LOGO_SIZE = 256;
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;

/**
 * Validates an image by its content (PNG, JPEG, WebP or GIF – never SVG), decodes it and
 * re-encodes it as a square PNG. Re-encoding drops all metadata and anything that isn't pixels.
 */
export async function normaliseLogo(input: Buffer): Promise<Buffer> {
	if (input.length > MAX_LOGO_BYTES) throw new UploadError('The logo must be 5 MB or smaller.');
	const mime = detectImageType(input);
	if (!mime) throw new UploadError('Use a PNG, JPEG or WebP image.');
	try {
		return await sharp(input, { limitInputPixels: MAX_PIXELS, animated: false })
			.rotate()
			.resize(LOGO_SIZE, LOGO_SIZE, {
				fit: 'contain',
				background: { r: 0, g: 0, b: 0, alpha: 0 }
			})
			.png({ compressionLevel: 9 })
			.toBuffer();
	} catch {
		throw new UploadError('The image could not be read.');
	}
}

/**
 * Stores a normalised logo. Pending logos (previews of a fetched website icon) belong to their
 * uploader only and are removed by the regular cleanup if never applied.
 */
export async function storeLogo(
	input: Buffer,
	opts: { uploaderId: number; projectId: number; name: string; pending?: boolean }
): Promise<Attachment> {
	const png = await normaliseLogo(input);
	const id = writeStoredFile(png, 'png');
	return getDb()
		.insert(schema.attachments)
		.values({
			id,
			uploaderId: opts.uploaderId,
			projectId: opts.projectId,
			originalName: opts.name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'logo.png',
			mimeType: 'image/png',
			extension: 'png',
			size: png.length,
			width: LOGO_SIZE,
			height: LOGO_SIZE,
			hasThumbnail: false,
			kind: 'project_logo',
			attachedAt: opts.pending ? null : new Date()
		})
		.returning()
		.get();
}

function dropLogo(id: string | null) {
	if (!id) return;
	const att = findAttachment(id);
	if (!att) return;
	getDb()
		.update(schema.attachments)
		.set({ deletedAt: new Date() })
		.where(eq(schema.attachments.id, id))
		.run();
	removeFiles(att);
}

export function requireLogoManager(access: ProjectAccess) {
	if (!access.isOwner || access.archived)
		throw new ServiceError('Only project owners can change the logo', 'logo', 403);
}

/**
 * Sets (or clears) a project's logo. A new logo must be one of this project's logo uploads,
 * made by the same user if it is still a pending preview. The previous logo file is removed.
 */
export function setProjectLogo(
	actorId: number,
	access: ProjectAccess,
	logoId: string | null,
	ip: string | null = null
) {
	requireLogoManager(access);
	const project = access.project;
	if (logoId) {
		const att = findAttachment(logoId);
		if (
			!att ||
			att.deletedAt ||
			att.kind !== 'project_logo' ||
			att.projectId !== project.id ||
			(!att.attachedAt && att.uploaderId !== actorId)
		)
			throw new ServiceError('That logo is not available', 'logo', 404);
	}
	const previous = project.logoId;
	if (previous === logoId) return;
	getDb().transaction((tx) => {
		if (logoId)
			tx.update(schema.attachments)
				.set({ attachedAt: new Date() })
				.where(and(eq(schema.attachments.id, logoId), eq(schema.attachments.kind, 'project_logo')))
				.run();
		tx.update(schema.projects)
			.set({ logoId, updatedAt: new Date() })
			.where(eq(schema.projects.id, project.id))
			.run();
		audit(
			{
				actorId,
				action: 'project.logo',
				targetType: 'project',
				targetId: project.id,
				data: { logo: logoId ? 'set' : 'removed' },
				ip
			},
			tx
		);
	});
	dropLogo(previous);
}

// ── Website icons ───────────────────────────────────────────────────────────

interface Candidate {
	url: URL;
	size: number;
}

function attributes(tag: string) {
	const attrs: Record<string, string> = {};
	for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
		attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
	return attrs;
}

function largestSize(sizes: string | undefined, fallback: number) {
	if (!sizes) return fallback;
	if (/any/i.test(sizes)) return 0; // usually SVG
	const values = [...sizes.matchAll(/(\d+)x(\d+)/gi)].map((m) => Math.min(+m[1], +m[2]));
	return values.length ? Math.max(...values) : fallback;
}

const isVector = (href: string, type?: string) =>
	/svg/i.test(type ?? '') || /\.svgz?(\?|#|$)/i.test(href);

/** Icon candidates declared by a page: <link rel="icon">, apple-touch-icon and the manifest. */
export function iconCandidates(html: string, pageUrl: URL) {
	const head = html.slice(0, 200_000);
	const base = (() => {
		const tag = /<base\b[^>]*>/i.exec(head)?.[0];
		const href = tag ? attributes(tag).href : undefined;
		try {
			return href ? new URL(href, pageUrl) : pageUrl;
		} catch {
			return pageUrl;
		}
	})();
	const icons: Candidate[] = [];
	let manifest: URL | null = null;
	for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
		const a = attributes(tag);
		const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
		if (!a.href) continue;
		let url: URL;
		try {
			url = new URL(a.href, base);
		} catch {
			continue;
		}
		if (rel.includes('manifest')) manifest = url;
		else if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
			if (!isVector(a.href, a.type)) icons.push({ url, size: largestSize(a.sizes, 180) });
		} else if (rel.includes('icon')) {
			if (!isVector(a.href, a.type)) icons.push({ url, size: largestSize(a.sizes, 32) });
		}
	}
	return { icons, manifest };
}

export function manifestCandidates(json: unknown, manifestUrl: URL): Candidate[] {
	const icons = (json as { icons?: unknown })?.icons;
	if (!Array.isArray(icons)) return [];
	const out: Candidate[] = [];
	for (const icon of icons.slice(0, 30)) {
		const src = typeof icon?.src === 'string' ? icon.src : '';
		if (!src || isVector(src, icon?.type)) continue;
		try {
			out.push({ url: new URL(src, manifestUrl), size: largestSize(icon?.sizes, 64) });
		} catch {
			/* skip */
		}
	}
	return out;
}

/** Prefers icons around 256 px: big enough to look sharp, small enough to download quickly. */
function rank(c: Candidate) {
	return c.size >= 64 ? 1000 - Math.abs(c.size - 256) / 4 : c.size;
}

/** Extracts the largest PNG image embedded in a .ico file (BMP-only icons are not supported). */
export function pngFromIco(buf: Buffer): Buffer | null {
	if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
	const count = Math.min(buf.readUInt16LE(4), 64);
	let best: { size: number; data: Buffer } | null = null;
	for (let i = 0; i < count; i++) {
		const entry = 6 + i * 16;
		if (entry + 16 > buf.length) break;
		const size = buf[entry] || 256;
		const length = buf.readUInt32LE(entry + 8);
		const offset = buf.readUInt32LE(entry + 12);
		if (offset + length > buf.length || length < 8) continue;
		const data = buf.subarray(offset, offset + length);
		if (detectImageType(data) === 'image/png' && (!best || size > best.size)) best = { size, data };
	}
	return best?.data ?? null;
}

/**
 * Finds a usable icon for a website. Every request goes through safeFetch (public addresses only,
 * validated redirects, timeouts, size limits). Returns the raw image; callers normalise it.
 */
export async function fetchWebsiteIcon(
	siteUrl: string,
	opts: { resolve?: Resolver; deadlineMs?: number } = {}
): Promise<Buffer> {
	const deadline = Date.now() + (opts.deadlineMs ?? 20_000);
	const remaining = () => {
		const left = deadline - Date.now();
		if (left <= 0) throw new FetchError('Fetching the icon took too long.');
		return Math.min(left, 6000);
	};
	// The page tells us where its icons are; if it can't be loaded (bot protection, an error page,
	// a firewall) the well-known icon paths of the same site are still worth trying.
	let page: Awaited<ReturnType<typeof safeFetch>> | null = null;
	let pageError: unknown = null;
	try {
		page = await safeFetch(siteUrl, {
			maxBytes: 1024 * 1024,
			accept: 'text/html,application/xhtml+xml',
			timeoutMs: remaining(),
			resolve: opts.resolve
		});
	} catch (err) {
		// Policy rejections and timeouts are final; anything else falls back to /favicon.ico.
		if (
			!(err instanceof FetchError) ||
			/took too long|not publicly reachable|private or reserved|Only http|credentials|standard web ports|not a valid|Could not find/.test(
				err.message
			)
		)
			throw err;
		pageError = err;
	}
	const origin = page?.url ?? new URL(siteUrl);
	const candidates: Candidate[] = [];
	if (page && page.contentType.includes('html')) {
		const { icons, manifest } = iconCandidates(page.body.toString('utf8'), page.url);
		candidates.push(...icons);
		if (manifest) {
			try {
				const res = await safeFetch(manifest, {
					maxBytes: 256 * 1024,
					accept: 'application/manifest+json,application/json',
					timeoutMs: remaining(),
					resolve: opts.resolve
				});
				candidates.push(...manifestCandidates(JSON.parse(res.body.toString('utf8')), res.url));
			} catch {
				/* a broken manifest doesn't stop the other candidates */
			}
		}
	}
	candidates.push({ url: new URL('/apple-touch-icon.png', origin), size: 180 });
	candidates.push({ url: new URL('/favicon.ico', origin), size: 32 });

	const seen = new Set<string>();
	const ordered = candidates
		.sort((a, b) => rank(b) - rank(a))
		.filter((c) => !seen.has(c.url.href) && seen.add(c.url.href))
		.slice(0, 6);
	for (const c of ordered) {
		try {
			const res = await safeFetch(c.url, {
				maxBytes: 2 * 1024 * 1024,
				accept: 'image/png,image/webp,image/jpeg,image/x-icon,image/*;q=0.8',
				timeoutMs: remaining(),
				resolve: opts.resolve
			});
			const image = detectImageType(res.body) ? res.body : pngFromIco(res.body);
			if (image) return image;
		} catch (err) {
			if (err instanceof FetchError && /took too long/.test(err.message)) throw err;
		}
	}
	// The page itself failed: its reason is the most useful one to show.
	if (pageError) throw pageError;
	throw new FetchError(
		'No usable icon was found on that website (SVG-only icons are not supported).'
	);
}
