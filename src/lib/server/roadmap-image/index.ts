import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import type { RoadmapSettings } from '../../shared/constants';
import { ticketRef } from '../../shared/format';
import type { Project } from '../db/schema';
import { roadmapFor } from '../services/roadmap';
import { findAttachment, originalPath } from '../uploads';
import { ensureFonts } from './font';
import { buildSvg, type ImageColumn, type RoadmapImageModel } from './svg';

/**
 * The shareable roadmap image. It is rendered on the server from the same data the roadmap page
 * shows a visitor (`roadmapFor`, with the visibility switches applied) – never a screenshot and
 * never a browser. Output is cached per project: the ETag is a hash of everything that appears
 * in the picture, so the PNG is only regenerated when roadmap-relevant data actually changes.
 */

/** Bump when the layout changes so cached images are rebuilt. */
const RENDER_VERSION = 1;
const MAX_CACHED = 200;

interface Entry {
	etag: string;
	png: Buffer;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Buffer>>();

const logoCache = new Map<string, Buffer>();

/**
 * The project's own stored logo (an approved, local attachment of that project), resized for the
 * header. Nothing is fetched remotely and no path comes from the request.
 */
async function loadLogo(project: Project): Promise<Buffer | null> {
	if (!project.logoId) return null;
	const hit = logoCache.get(project.logoId);
	if (hit) return hit;
	const att = findAttachment(project.logoId);
	if (!att || att.kind !== 'project_logo' || att.deletedAt || att.projectId !== project.id)
		return null;
	try {
		const png = await sharp(fs.readFileSync(originalPath(att)))
			.resize(96, 96, { fit: 'cover' })
			.png()
			.toBuffer();
		if (logoCache.size > 100) logoCache.clear();
		logoCache.set(project.logoId, png);
		return png;
	} catch {
		return null;
	}
}

export interface PreparedImage {
	etag: string;
	/** What the picture will contain (the only data that ever reaches it). */
	columns: ImageColumn[];
	/** Renders (or returns the cached) PNG. */
	png(): Promise<Buffer>;
}

/**
 * Collects the roadmap as a visitor with these `settings` may see it and returns its ETag.
 * `openColumn` adds the Open / Unplanned column (staff exports, or when the owner shows it).
 */
export function prepareRoadmapImage(
	project: Project,
	settings: RoadmapSettings,
	openColumn: boolean
): PreparedImage {
	// full = false: staff-only details (assignees, hidden priorities, releases…) stay out.
	const view = roadmapFor(project, settings, false, openColumn);
	const card = (c: (typeof view.columns.planned)[number]) => ({
		key: ticketRef(project.key, c.number),
		title: c.title,
		type: c.type,
		votes: c.voteCount,
		release: c.release
	});
	const columns: ImageColumn[] = [
		...(openColumn
			? [
					{
						id: 'open' as const,
						label: 'Open / Unplanned',
						total: view.totals.open,
						cards: view.columns.open.map(card)
					}
				]
			: []),
		{
			id: 'planned',
			label: 'Planned',
			total: view.totals.planned,
			cards: view.columns.planned.map(card)
		},
		{
			id: 'in_progress',
			label: 'In Progress',
			total: view.totals.in_progress,
			cards: view.columns.in_progress.map(card)
		},
		{
			id: 'completed',
			label: 'Completed',
			total: view.totals.completed,
			cards: view.columns.completed.map(card)
		}
	];
	const { image } = settings;
	const etag = `"${crypto
		.createHash('sha1')
		.update(
			JSON.stringify([
				RENDER_VERSION,
				project.name,
				project.accentColor,
				image.showLogo ? project.logoId : null,
				image.layout,
				image.showTimestamp,
				columns
			])
		)
		.digest('hex')
		.slice(0, 20)}"`;
	const key = `${project.id}:${openColumn ? 1 : 0}`;

	const render = async () => {
		const model: RoadmapImageModel = {
			projectName: project.name,
			accent: project.accentColor,
			logoPng: image.showLogo ? await loadLogo(project) : null,
			layout: image.layout,
			stamp: image.showTimestamp
				? `Updated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
				: null,
			columns
		};
		ensureFonts();
		// 1.5x pixel density keeps text crisp on high-resolution screens.
		const png = await sharp(Buffer.from(buildSvg(model)), { density: 144 })
			.png({ compressionLevel: 9, palette: false })
			.toBuffer();
		if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
		cache.delete(key);
		cache.set(key, { etag, png });
		return png;
	};

	return {
		etag,
		columns,
		png: () => {
			const hit = cache.get(key);
			if (hit?.etag === etag) return Promise.resolve(hit.png);
			const flight = `${key}:${etag}`;
			let pending = inflight.get(flight);
			if (!pending) {
				pending = render().finally(() => inflight.delete(flight));
				inflight.set(flight, pending);
			}
			return pending;
		}
	};
}

/** Test helper: drop cached renders. */
export function clearRoadmapImageCache() {
	cache.clear();
	logoCache.clear();
}
