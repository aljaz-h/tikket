import { error } from '@sveltejs/kit';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, intParam, requireActionUser } from '$lib/server/http';
import { normaliseRichInput } from '$lib/server/sanitize';
import { completedTickets, deleteChangelogEntry, listChangelog, saveChangelogEntry } from '$lib/server/services/changelog';
import { changelogSchema, parseForm } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const access = requireProject(locals.user, params.key, 'view');
	const canManage = access.isOwner && !access.archived;
	return {
		title: `Changelog · ${access.project.name}`,
		entries: listChangelog(access.project.id, canManage),
		completed: canManage ? completedTickets(access.project.id) : [],
		canManage
	};
};

async function save(locals: App.Locals, key: string, request: Request) {
	const user = requireActionUser(locals);
	const access = requireProject(user, key, 'owner');
	if (access.archived) error(403, 'This project is archived');
	const form = await request.formData();
	const parsed = parseForm(changelogSchema, form);
	if (!parsed.ok) return parsed.failure;
	const summary = normaliseRichInput(parsed.data.summary, parsed.data.summaryFormat);
	const ticketIds = form.getAll('ticketId').map((v) => intParam(String(v))).filter((v): v is number => v !== null);
	try {
		saveChangelogEntry(
			access.project.id,
			user.id,
			{ version: parsed.data.version, releaseDate: parsed.data.releaseDate, summaryHtml: summary.html, published: parsed.data.published, ticketIds },
			intParam(String(form.get('entryId') ?? '')) ?? undefined
		);
	} catch (err) {
		return handleServiceError(err);
	}
	return { saved: true };
}

export const actions: Actions = {
	save: async ({ locals, params, request }) => save(locals, params.key, request),
	delete: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const id = intParam(String((await request.formData()).get('entryId')));
		if (!id || !deleteChangelogEntry(access.project.id, id)) error(404, 'Entry not found');
		return { deleted: true };
	}
};
