import crypto from 'node:crypto';
import fs from 'node:fs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { Project } from '../db/schema';
import { originalPath } from '../uploads';
import { ZipWriter } from '../zip';
import { projectJsonStream, type ExportScope } from './export';

/**
 * Project bundle export (`.zip`, format "tikket-project-bundle" version 1): the project JSON
 * export plus the attachment files it references, with a manifest of SHA-256 checksums.
 *
 *   manifest.json              format, version, project, checksums of every file
 *   project.json               the regular project export (standard or staff scope)
 *   attachments/<id>.<ext>     original image files (ticket and comment attachments)
 *
 * Attachments are streamed one by one, so large projects are never held in memory as a whole.
 * A staff bundle includes images of internal notes, like the staff JSON export.
 */

export const BUNDLE_FORMAT = 'tikket-project-bundle';
export const BUNDLE_VERSION = 1;
/** Above this, the export page warns that the download will be large. */
export const BUNDLE_WARN_BYTES = 100 * 1024 * 1024;

export interface BundleManifestFile {
	path: string;
	sha256: string;
	size: number;
	attachmentId: string;
	name: string;
	mimeType: string;
	width: number | null;
	height: number | null;
}
export interface BundleManifest {
	format: typeof BUNDLE_FORMAT;
	version: number;
	createdAt: string;
	project: string;
	projectJson: { path: 'project.json'; sha256: string; size: number };
	files: BundleManifestFile[];
}

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** Number and total size of the attachments a bundle would contain (for the size warning). */
export function bundleEstimate(projectId: number) {
	const a = schema.attachments;
	const row = getDb()
		.select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${a.size}), 0)` })
		.from(a)
		.where(and(eq(a.projectId, projectId), isNull(a.deletedAt), sql`${a.ticketId} is not null`))
		.get();
	return { count: Number(row?.n ?? 0), bytes: Number(row?.bytes ?? 0) };
}

async function collect(stream: ReadableStream<Uint8Array>) {
	return Buffer.from(await new Response(stream).arrayBuffer());
}

export function projectBundleStream(
	project: Project,
	scope: ExportScope
): ReadableStream<Uint8Array> {
	const zip = new ZipWriter();
	let queue: { id: string; name: string }[] | null = null;
	const files: BundleManifestFile[] = [];
	let projectJson: BundleManifest['projectJson'] | null = null;
	let done = false;
	return new ReadableStream({
		async pull(controller) {
			try {
				if (done) return;
				if (!queue) {
					const json = await collect(projectJsonStream(project, scope));
					projectJson = { path: 'project.json', sha256: sha256(json), size: json.length };
					controller.enqueue(zip.add('project.json', json));
					// Exactly the attachments listed in this export (respects the scope).
					const parsed = JSON.parse(json.toString('utf8')) as {
						tickets: { attachments?: { id: string; name: string }[] }[];
					};
					queue = parsed.tickets.flatMap((t) => t.attachments ?? []);
					return;
				}
				const next = queue.shift();
				if (next) {
					const att = getDb()
						.select()
						.from(schema.attachments)
						.where(eq(schema.attachments.id, next.id))
						.get();
					if (!att) return;
					let data: Buffer;
					try {
						data = fs.readFileSync(originalPath(att));
					} catch {
						return; // file missing on disk: left out (the importer reports it)
					}
					const path = `attachments/${att.id}.${att.extension}`;
					files.push({
						path,
						sha256: sha256(data),
						size: data.length,
						attachmentId: att.id,
						name: att.originalName,
						mimeType: att.mimeType,
						width: att.width,
						height: att.height
					});
					// Images are already compressed: store them as they are.
					controller.enqueue(zip.add(path, data, false));
					return;
				}
				const manifest: BundleManifest = {
					format: BUNDLE_FORMAT,
					version: BUNDLE_VERSION,
					createdAt: new Date().toISOString(),
					project: project.key,
					projectJson: projectJson!,
					files
				};
				controller.enqueue(
					zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
				);
				controller.enqueue(zip.finish());
				done = true;
				controller.close();
			} catch (err) {
				controller.error(err);
			}
		}
	});
}
