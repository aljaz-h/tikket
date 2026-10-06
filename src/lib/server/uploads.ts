import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageMimeType } from '../shared/constants';
import { formatBytes } from '../shared/text';
import { config } from './config';
import { randomId } from './auth/tokens';
import { getDb, schema } from './db';
import type { Attachment } from './db/schema';
import { getSettings, maxAttachmentBytes } from './settings';

const ID_RE = /^[a-f0-9]{32}$/;
const EXTENSIONS: Record<ImageMimeType, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};
const MAX_PIXELS = 60_000_000;
const THUMB_WIDTH = 640;

export class UploadError extends Error {}

/** Detects the real image type from magic bytes – the declared MIME type is never trusted. */
export function detectImageType(buf: Uint8Array): ImageMimeType | null {
	if (buf.length < 12) return null;
	if (
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
	)
		return 'image/png';
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
	const ascii = (start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));
	if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

function shard(id: string) {
	if (!ID_RE.test(id)) throw new UploadError('Invalid attachment id');
	return path.join(config.uploadsDir, id.slice(0, 2));
}

export function originalPath(att: Pick<Attachment, 'id' | 'extension'>): string {
	return path.join(shard(att.id), `${att.id}.${att.extension}`);
}

export function thumbnailPath(att: Pick<Attachment, 'id'>): string {
	return path.join(shard(att.id), `${att.id}.thumb.webp`);
}

/** Keeps only a harmless display name; storage always uses the random id. */
export function cleanDisplayName(name: string, ext: string): string {
	const base = path
		.basename(name || 'image')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
		.trim()
		.slice(0, 120);
	if (!base) return `image.${ext}`;
	return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}

export interface StoreOptions {
	uploaderId: number;
	kind?: 'avatar';
}

/**
 * Validates and stores an uploaded image as a *pending* attachment. Re-encodes still images to
 * strip metadata (e.g. GPS EXIF) and produces a WebP thumbnail.
 */
export async function storeImage(file: File, opts: StoreOptions): Promise<Attachment> {
	const settings = getSettings();
	const limit = maxAttachmentBytes();
	if (!(file instanceof File) || file.size === 0) throw new UploadError('The file is empty.');
	if (file.size > limit)
		throw new UploadError(`“${file.name}” is larger than the ${formatBytes(limit)} limit.`);

	const input = Buffer.from(await file.arrayBuffer());
	const mime = detectImageType(input);
	if (!mime)
		throw new UploadError(`“${file.name}” is not a supported image (PNG, JPEG, WebP or GIF).`);
	if (!settings.allowedImageTypes.includes(mime))
		throw new UploadError(`${EXTENSIONS[mime].toUpperCase()} images are not allowed.`);

	let output: Buffer = input;
	let width: number | undefined;
	let height: number | undefined;
	try {
		const image = sharp(input, { limitInputPixels: MAX_PIXELS, animated: mime === 'image/gif' });
		const meta = await image.metadata();
		width = meta.width;
		height = meta.pageHeight ?? meta.height;
		if (mime !== 'image/gif') {
			// Auto-orient and drop all metadata.
			const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate();
			output =
				mime === 'image/png'
					? await pipeline.png({ compressionLevel: 8 }).toBuffer()
					: mime === 'image/webp'
						? await pipeline.webp({ quality: 90 }).toBuffer()
						: await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
			const after = await sharp(output).metadata();
			width = after.width;
			height = after.height;
			// Never store a re-encoded file that grew beyond the limit.
			if (output.length > limit) output = input;
		}
	} catch {
		throw new UploadError(`“${file.name}” could not be read as an image.`);
	}

	const id = randomId(16);
	const ext = EXTENSIONS[mime];
	const record = { id, extension: ext };
	fs.mkdirSync(shard(id), { recursive: true });
	fs.writeFileSync(originalPath(record), output, { mode: 0o640 });

	let hasThumbnail = false;
	try {
		const thumbWidth = opts.kind === 'avatar' ? 256 : THUMB_WIDTH;
		const pipeline = sharp(output, { limitInputPixels: MAX_PIXELS }).rotate();
		await (
			opts.kind === 'avatar'
				? pipeline.resize(thumbWidth, thumbWidth, { fit: 'cover' })
				: pipeline.resize({ width: thumbWidth, withoutEnlargement: true })
		)
			.webp({ quality: 80 })
			.toFile(thumbnailPath(record));
		hasThumbnail = true;
	} catch {
		// Thumbnails are optional; the original is served instead.
	}

	const row = getDb()
		.insert(schema.attachments)
		.values({
			id,
			uploaderId: opts.uploaderId,
			originalName: cleanDisplayName(file.name, ext),
			mimeType: mime,
			extension: ext,
			size: output.length,
			width: width ?? null,
			height: height ?? null,
			hasThumbnail,
			kind: opts.kind ?? null,
			attachedAt: opts.kind === 'avatar' ? new Date() : null
		})
		.returning()
		.get();
	return row;
}

export function findAttachment(id: string): Attachment | undefined {
	if (!ID_RE.test(id)) return undefined;
	return getDb().select().from(schema.attachments).where(eq(schema.attachments.id, id)).get();
}

/** Pending (not yet attached) uploads owned by the user, in the order requested. */
export function pendingAttachmentsFor(userId: number, ids: string[]): Attachment[] {
	const valid = [...new Set(ids.filter((id) => ID_RE.test(id)))];
	if (!valid.length) return [];
	const rows = getDb()
		.select()
		.from(schema.attachments)
		.where(
			and(
				inArray(schema.attachments.id, valid),
				eq(schema.attachments.uploaderId, userId),
				isNull(schema.attachments.attachedAt),
				isNull(schema.attachments.deletedAt)
			)
		)
		.all();
	return valid.map((id) => rows.find((r) => r.id === id)).filter((r): r is Attachment => !!r);
}

export function removeFiles(att: Pick<Attachment, 'id' | 'extension'>) {
	for (const file of [originalPath(att), thumbnailPath(att)]) {
		try {
			fs.unlinkSync(file);
		} catch {
			/* already gone */
		}
	}
}

/** Deletes a pending upload belonging to the user. */
export function discardPending(userId: number, id: string): boolean {
	const [att] = pendingAttachmentsFor(userId, [id]);
	if (!att) return false;
	getDb().delete(schema.attachments).where(eq(schema.attachments.id, att.id)).run();
	removeFiles(att);
	return true;
}

/** Removes uploads that were never attached to a ticket or comment. */
export function cleanupAbandonedUploads(maxAgeMs = 24 * 60 * 60 * 1000): number {
	const db = getDb();
	const cutoff = new Date(Date.now() - maxAgeMs);
	const stale = db
		.select()
		.from(schema.attachments)
		.where(and(isNull(schema.attachments.attachedAt), lt(schema.attachments.createdAt, cutoff)))
		.all();
	for (const att of stale) {
		db.delete(schema.attachments).where(eq(schema.attachments.id, att.id)).run();
		removeFiles(att);
	}
	return stale.length;
}
