import type { SessionInfo, SessionUser } from '$lib/server/auth/session';
import type { Theme } from '$lib/shared/constants';

declare global {
	namespace App {
		interface Error {
			message: string;
			errorId?: string;
		}
		interface Locals {
			user: SessionUser | null;
			session: SessionInfo | null;
			clientIp: string | null;
			theme: Theme;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
