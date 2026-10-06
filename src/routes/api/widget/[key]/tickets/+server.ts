import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { handleServiceError } from '$lib/server/http';
import { normaliseRichInput } from '$lib/server/sanitize';
import { resolveTemplate } from '$lib/server/services/templates';
import { createTicket } from '$lib/server/services/tickets';
import { ServiceError } from '$lib/server/services/users';
import { NO_STORE, widgetAuth } from '$lib/server/widget-api';
import { TICKET_TYPES } from '$lib/shared/constants';
import { ticketPath, ticketRef } from '$lib/shared/format';
import { validateTemplateAnswers } from '$lib/shared/templates';
import { sanitizeEnvironment } from '$lib/shared/widget';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	type: z.enum(TICKET_TYPES.filter((t) => t !== 'feedback') as ['bug', 'feature', 'improvement']),
	title: z
		.string()
		.trim()
		.min(4, 'Give your report a short title (at least 4 characters)')
		.max(160),
	description: z
		.string()
		.trim()
		.min(1, 'Please describe what you would like to report')
		.max(20_000),
	attachmentIds: z
		.array(z.string().regex(/^[a-f0-9]{32}$/))
		.max(50)
		.default([]),
	context: z.unknown().optional(),
	templateId: z.number().int().positive().nullable().optional(),
	answers: z.record(z.string(), z.union([z.string().max(6000), z.boolean()])).default({}),
	/** Honeypot: must stay empty (hidden from humans). */
	website: z.string().max(200).optional(),
	/** Milliseconds the form was open; instant submissions are bots. */
	elapsedMs: z.number().int().nonnegative()
});

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const { user, access, project, config, origin } = widgetAuth(request, params.key);

	let ip = 'unknown';
	try {
		ip = getClientAddress();
	} catch {
		/* ignore */
	}
	const wait = Math.max(
		limiters.widgetIp.hit(`widget:${ip}`),
		limiters.write.hit(`write:${user.id}`)
	);
	if (wait) error(429, `Too many reports. Try again in ${formatWait(wait)}.`);

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json(
			{ errors: { [issue.path.join('.') || 'form']: issue.message } },
			{ status: 400, headers: NO_STORE }
		);
	}
	const body = parsed.data;
	if (body.website || body.elapsedMs < 1500)
		return json(
			{ errors: { form: 'Your report could not be sent. Please try again.' } },
			{ status: 400, headers: NO_STORE }
		);
	if (body.attachmentIds.length && !config.screenshotsEnabled)
		error(403, 'Screenshots are disabled for this widget');

	const template = resolveTemplate(project.id, body.type, body.templateId ?? null);
	let templateResponse = null;
	if (template) {
		const result = validateTemplateAnswers(template.fields, body.answers);
		if (!result.ok) return json({ errors: result.errors }, { status: 400, headers: NO_STORE });
		templateResponse = {
			templateId: template.id,
			templateName: template.name,
			templateVersion: template.version,
			answers: result.answers
		};
	}

	const description = normaliseRichInput(body.description, 'text');
	// Context is optional, reviewed by the user in the form, and sanitised again here.
	const environment = config.collectContext ? sanitizeEnvironment(body.context, origin) : null;
	try {
		const ticket = createTicket(
			user,
			access,
			{
				type: body.type,
				title: body.title,
				descriptionHtml: description.html,
				descriptionText: description.text,
				context: {}
			},
			body.attachmentIds,
			{ source: 'widget', environment, template: templateResponse }
		);
		return json(
			{ ref: ticketRef(project.key, ticket.number), path: ticketPath(project.key, ticket.number) },
			{ status: 201, headers: NO_STORE }
		);
	} catch (err) {
		if (err instanceof ServiceError)
			return json(
				{ errors: { [err.field]: err.message } },
				{ status: err.status, headers: NO_STORE }
			);
		const failure = handleServiceError(err);
		return json(failure.data, { status: failure.status, headers: NO_STORE });
	}
};
