import { error } from '@sveltejs/kit';

/** Every admin action re-checks the role (layouts do not protect form actions). */
export function adminActor(locals: App.Locals) {
	const user = locals.user;
	if (!user) error(401, 'Please sign in');
	if (user.role !== 'admin') error(403, 'Administrator access required');
	return user;
}
