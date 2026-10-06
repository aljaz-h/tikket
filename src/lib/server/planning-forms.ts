import { error } from '@sveltejs/kit';
import type { ProjectAccess } from './authz';
import { normaliseRichInput } from './sanitize';
import type { MilestoneInput } from './services/milestones';
import type { ReleaseInput } from './services/releases';
import { milestoneSchema, parseForm, releaseSchema } from './validation';

/** Release and milestone pages are planning tools for project staff; others get a 404. */
export function requireStaffView(access: ProjectAccess) {
	if (!access.isStaff) error(404, 'Not found');
	return access;
}

export function parseReleaseForm(form: FormData) {
	const parsed = parseForm(releaseSchema, form);
	if (!parsed.ok) return parsed;
	const notes = normaliseRichInput(parsed.data.summary, parsed.data.summaryFormat);
	const input: ReleaseInput = {
		version: parsed.data.version,
		targetDate: parsed.data.targetDate,
		status: parsed.data.status,
		summaryHtml: notes.text.trim() ? notes.html : ''
	};
	return { ok: true as const, data: input };
}

export function parseMilestoneForm(form: FormData) {
	const parsed = parseForm(milestoneSchema, form);
	if (!parsed.ok) return parsed;
	const input: MilestoneInput = parsed.data;
	return { ok: true as const, data: input };
}
