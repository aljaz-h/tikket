import fs from 'node:fs';
import { Readable } from 'node:stream';
import type { Attachment } from './db/schema';
import { originalPath, thumbnailPath } from './uploads';

/** Streams a stored image with safe, cache-friendly headers. */
export function serveAttachment(
	att: Attachment,
	opts: { thumb?: boolean; download?: boolean; request: Request; cache?: string }
): Response {
	const useThumb = opts.thumb && att.hasThumbnail;
	const file = useThumb ? thumbnailPath(att) : originalPath(att);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(file);
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const etag = `"${att.id}${useThumb ? '-t' : ''}"`;
	const headers = new Headers({
		'content-type': useThumb ? 'image/webp' : att.mimeType,
		'cache-control': opts.cache ?? 'private, max-age=86400',
		etag,
		'x-content-type-options': 'nosniff',
		'content-security-policy':
			"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
		'cross-origin-resource-policy': 'same-origin',
		'content-disposition': `${opts.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(att.originalName)}`
	});
	if (opts.request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers });
	headers.set('content-length', String(stat.size));
	const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
	return new Response(stream, { headers });
}
