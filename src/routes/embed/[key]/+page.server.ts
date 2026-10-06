import { error } from '@sveltejs/kit';
import { activeTemplates } from '$lib/server/services/templates';
import { findWidget, isOriginAllowed } from '$lib/server/services/widget';
import { getSettings, maxAttachmentBytes } from '$lib/server/settings';
import { normalizeOrigin } from '$lib/shared/widget';
import type { PageServerLoad } from './$types';

/**
 * The widget form, rendered inside the host site's iframe. The browser enforces who may frame it
 * (CSP frame-ancestors = allowed origins, set in hooks.server.ts); `host` only tells the page
 * which origin to talk to via postMessage and must itself be allowed.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const widget = findWidget(params.key);
	if (!widget) error(404, 'This feedback widget is not available');
	const raw = url.searchParams.get('host') ?? '';
	const host = normalizeOrigin(raw);
	const allowed =
		!!host && host === raw && (host === url.origin || isOriginAllowed(widget.project.id, host));
	const settings = getSettings();
	return {
		title: `Feedback · ${widget.project.name}`,
		key: widget.project.key,
		projectName: widget.project.name,
		host: allowed ? host : null,
		config: {
			buttonLabel: widget.config.buttonLabel,
			accentColor: widget.config.accentColor,
			defaultType: widget.config.defaultType === 'feedback' ? 'bug' : widget.config.defaultType,
			screenshotsEnabled: widget.config.screenshotsEnabled && widget.project.attachmentsEnabled,
			collectContext: widget.config.collectContext
		},
		templates: allowed
			? activeTemplates(widget.project.id).filter((t) => t.type !== 'feedback')
			: [],
		limits: {
			maxFiles: settings.maxAttachmentsPerTicket,
			maxSize: maxAttachmentBytes(),
			accept: settings.allowedImageTypes
		}
	};
};
