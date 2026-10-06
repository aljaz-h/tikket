import { error } from '@sveltejs/kit';
import { bearerToken, findWidget, validateWidgetToken } from './services/widget';

/**
 * Resolves the widget and the bearer token for widget API calls made by the iframe. The token is
 * the only credential accepted here: cookies are deliberately ignored, so a third-party page can
 * never ride on a user's Tikket session.
 */
export function widgetAuth(request: Request, key: string) {
	const widget = findWidget(key);
	if (!widget) error(404, 'Widget not available');
	const auth = validateWidgetToken(bearerToken(request), widget.project);
	if (!auth) error(401, 'Please sign in to send feedback');
	return { ...widget, ...auth };
}

export const NO_STORE = { 'cache-control': 'no-store' };
