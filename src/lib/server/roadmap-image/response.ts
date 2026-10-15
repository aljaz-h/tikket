import type { PreparedImage } from './index';

/** True when the request's If-None-Match already names this ETag. */
export function etagMatches(request: Request, etag: string) {
	const header = request.headers.get('if-none-match');
	if (!header) return false;
	if (header.trim() === '*') return true;
	return header.split(',').some((v) => v.trim().replace(/^W\//, '') === etag);
}

/** Serves a roadmap PNG with an ETag; unchanged content answers 304 without rendering. */
export async function pngResponse(
	request: Request,
	image: PreparedImage,
	opts: { cacheControl: string; filename?: string; download?: boolean; crossOrigin?: boolean }
) {
	const headers = new Headers({
		etag: image.etag,
		'cache-control': opts.cacheControl,
		'x-content-type-options': 'nosniff'
	});
	if (opts.crossOrigin) headers.set('cross-origin-resource-policy', 'cross-origin');
	if (etagMatches(request, image.etag)) return new Response(null, { status: 304, headers });
	const png = await image.png();
	headers.set('content-type', 'image/png');
	headers.set('content-length', String(png.length));
	if (opts.filename)
		headers.set(
			'content-disposition',
			`${opts.download ? 'attachment' : 'inline'}; filename="${opts.filename}"`
		);
	return new Response(new Uint8Array(png), { headers });
}
