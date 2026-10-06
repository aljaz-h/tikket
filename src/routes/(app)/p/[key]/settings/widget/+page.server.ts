import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { requireProject } from '$lib/server/authz';
import { handleServiceError, requireActionUser } from '$lib/server/http';
import {
	getWidgetConfig,
	listAllowedOrigins,
	parseOriginList,
	saveWidgetSettings
} from '$lib/server/services/widget';
import { getSettings } from '$lib/server/settings';
import { WIDGET_POSITIONS } from '$lib/shared/constants';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const access = requireProject(locals.user, params.key, 'owner');
	return {
		title: `Feedback widget · ${access.project.name}`,
		widget: getWidgetConfig(access.project.id),
		origins: listAllowedOrigins(access.project.id),
		baseUrl: (getSettings().appUrl || url.origin).replace(/\/$/, ''),
		selfOrigin: url.origin,
		projectVisibility: access.project.visibility,
		submissionPolicy: access.project.submissionPolicy
	};
};

const schema = z.object({
	enabled: z
		.string()
		.optional()
		.transform((v) => v === 'on'),
	buttonLabel: z.string().trim().max(30).default('Feedback'),
	position: z.enum(WIDGET_POSITIONS),
	accentColor: z.string().trim(),
	defaultType: z.enum(['bug', 'feature', 'improvement']),
	screenshotsEnabled: z
		.string()
		.optional()
		.transform((v) => v === 'on'),
	collectContext: z
		.string()
		.optional()
		.transform((v) => v === 'on'),
	origins: z.string().max(10_000).default('')
});

export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const user = requireActionUser(locals);
		const access = requireProject(user, params.key, 'owner');
		const form = Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
		const parsed = schema.safeParse(form);
		if (!parsed.success)
			return fail(400, { errors: { form: parsed.error.issues[0].message }, values: form });
		const { origins, invalid } = parseOriginList(parsed.data.origins);
		if (invalid.length)
			return fail(400, {
				errors: { origins: `Not a valid origin: ${invalid.slice(0, 3).join(', ')}` },
				values: form
			});
		try {
			saveWidgetSettings(user.id, access.project, { ...parsed.data, origins }, locals.clientIp);
		} catch (err) {
			return handleServiceError(err, form);
		}
		return { saved: true };
	}
};
