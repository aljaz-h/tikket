import { CONTEXT_FIELDS, type TicketContext, type TicketType } from '../shared/constants';
import { limiters, formatWait } from './auth/rate-limit';
import { normaliseRichInput } from './sanitize';
import { ServiceError } from './services/users';
import { pendingAttachmentsFor, storeImage } from './uploads';
import { formToObject, ticketContextSchema, ticketInputSchema, zodErrors, type FieldErrors } from './validation';
import type { TicketInput } from './services/tickets';

export interface ParsedTicketForm {
	input: TicketInput;
	attachmentIds: string[];
}

/** Values echoed back to the form after a validation error. */
export function ticketFormValues(form: FormData) {
	const raw = formToObject(form);
	return { ...raw, attachmentIds: form.getAll('attachmentIds').map(String).join(',') };
}

/**
 * Parses and validates a ticket form (shared by create and edit). Rich text is sanitised,
 * contextual fields are limited to the ones that belong to the selected type, and any files
 * submitted by the no-JavaScript fallback are stored as pending uploads.
 */
export async function parseTicketForm(
	form: FormData,
	userId: number,
	opts: { allowFiles: boolean }
): Promise<{ ok: true; data: ParsedTicketForm } | { ok: false; errors: FieldErrors }> {
	const raw = formToObject(form);
	const base = ticketInputSchema.safeParse(raw);
	const errors: FieldErrors = base.success ? {} : zodErrors(base.error);
	const type = (base.success ? base.data.type : raw.type) as TicketType;
	const allowed = new Set<string>((CONTEXT_FIELDS[type] ?? []).map((f) => f.key));
	const ctxRaw = Object.fromEntries(Object.entries(raw).filter(([k]) => k.startsWith('ctx_')).map(([k, v]) => [k.slice(4), v]).filter(([k]) => allowed.has(k)));
	const ctx = ticketContextSchema.safeParse(ctxRaw);
	if (!ctx.success) for (const [k, v] of Object.entries(zodErrors(ctx.error))) errors[`ctx_${k}`] = v;

	let description = { html: '', text: '' };
	if (base.success) {
		description = normaliseRichInput(base.data.description, base.data.descriptionFormat);
		if (!description.text.trim()) errors.description = 'Please describe what you would like to report';
	}
	if (Object.keys(errors).length || !base.success || !ctx.success) return { ok: false, errors };

	const attachmentIds = form.getAll('attachmentIds').map(String).filter(Boolean);
	const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
	if (files.length) {
		if (!opts.allowFiles) return { ok: false, errors: { attachments: 'Attachments are disabled for this project' } };
		const wait = limiters.upload.hit(`upload:${userId}`);
		if (wait) return { ok: false, errors: { attachments: `Too many uploads. Try again in ${formatWait(wait)}.` } };
		for (const file of files) attachmentIds.push((await storeImage(file, { uploaderId: userId })).id);
	}

	return {
		ok: true,
		data: {
			input: {
				type: base.data.type,
				title: base.data.title,
				descriptionHtml: description.html,
				descriptionText: description.text,
				context: ctx.data as TicketContext
			},
			attachmentIds
		}
	};
}

export function checkWriteLimit(userId: number) {
	const wait = limiters.write.hit(`write:${userId}`);
	if (wait) throw new ServiceError(`You are doing that too often. Try again in ${formatWait(wait)}.`, 'form', 429);
}

/** Pending uploads to show again after a failed submission. */
export function pendingPreview(userId: number, ids: string[]) {
	return pendingAttachmentsFor(userId, ids).map((a) => ({ id: a.id, name: a.originalName, size: a.size, preview: `/api/files/${a.id}?thumb=1` }));
}
