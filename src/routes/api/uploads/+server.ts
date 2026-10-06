import { error, json } from '@sveltejs/kit';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { storeImage, UploadError } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/** Uploads a single image as a pending attachment owned by the current user. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, 'Please sign in to upload images');
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
		return json({ id: att.id, name: att.originalName, size: att.size, width: att.width, height: att.height }, { status: 201 });
	} catch (err) {
		if (err instanceof UploadError) error(400, err.message);
		throw err;
	}
};
