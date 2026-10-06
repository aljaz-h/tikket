import { error, json } from '@sveltejs/kit';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { storeImage, UploadError } from '$lib/server/uploads';
import { NO_STORE, widgetAuth } from '$lib/server/widget-api';
import type { RequestHandler } from './$types';

/** Screenshot upload from the widget (same validation and storage as the main app). */
export const POST: RequestHandler = async ({ params, request }) => {
	const { user, config, access } = widgetAuth(request, params.key);
	if (!config.screenshotsEnabled || !access.canAttach)
		error(403, 'Screenshots are disabled for this widget');
	const wait = limiters.upload.hit(`upload:${user.id}`);
	if (wait) error(429, `Too many uploads. Try again in ${formatWait(wait)}.`);
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(413, 'The upload is too large');
	}
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file received');
	try {
		const att = await storeImage(file, { uploaderId: user.id });
		return json(
			{ id: att.id, name: att.originalName, size: att.size, width: att.width, height: att.height },
			{ status: 201, headers: NO_STORE }
		);
	} catch (err) {
		if (err instanceof UploadError) error(400, err.message);
		throw err;
	}
};
