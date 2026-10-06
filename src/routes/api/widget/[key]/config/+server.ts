import { json } from '@sveltejs/kit';
import { findWidget, isOriginAllowed, recordWidgetSeen } from '$lib/server/services/widget';
import type { RequestHandler } from './$types';

/**
 * Public widget configuration for the loader. Answers only requests from an allowed origin of an
 * enabled widget; everything else (unknown key, disabled widget, other origin) is an identical 404,
 * so the endpoint cannot be used to discover projects. No credentials are involved.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const origin = request.headers.get('origin');
	const widget = findWidget(params.key);
	const headers = {
		'cache-control': 'no-store',
		vary: 'Origin',
		'cross-origin-resource-policy': 'cross-origin'
	};
	if (!widget || !origin || !isOriginAllowed(widget.project.id, origin))
		return json({ enabled: false }, { status: 404, headers });
	recordWidgetSeen(widget.project.id, origin);
	const c = widget.config;
	return json(
		{
			enabled: true,
			buttonLabel: c.buttonLabel,
			position: c.position,
			accentColor: c.accentColor,
			collectContext: c.collectContext
		},
		{ headers: { ...headers, 'access-control-allow-origin': origin } }
	);
};
