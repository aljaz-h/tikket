import { listProjects } from '$lib/server/services/projects';
import { unreadCount } from '$lib/server/services/notifications';
import { getSettings, maxAttachmentBytes } from '$lib/server/settings';
import { canCreateProjects } from '$lib/server/authz';
import { SIDEBAR_COOKIE } from '$lib/shared/constants';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends, url, cookies }) => {
	depends('app:shell');
	// Touching the URL re-runs this cheap load on navigation, keeping the unread count fresh without polling.
	void url.pathname;
	const settings = getSettings();
	const user = locals.user;
	return {
		user,
		theme: locals.theme,
		// Rendered server-side so a collapsed sidebar doesn't flash open on reload.
		sidebarCollapsed: cookies.get(SIDEBAR_COOKIE) === 'collapsed',
		app: {
			name: settings.appName,
			registrationEnabled: settings.registrationEnabled,
			maxAttachmentSize: maxAttachmentBytes(),
			maxAttachments: settings.maxAttachmentsPerTicket,
			allowedImageTypes: settings.allowedImageTypes
		},
		unreadCount: user ? unreadCount(user.id) : 0,
		canCreateProjects: canCreateProjects(user, settings.allowUserProjectCreation),
		sidebarProjects: listProjects(user).map((p) => ({
			key: p.key,
			name: p.name,
			icon: p.icon,
			color: p.color,
			logoId: p.logoId,
			role: p.role,
			openCount: p.openCount
		}))
	};
};
