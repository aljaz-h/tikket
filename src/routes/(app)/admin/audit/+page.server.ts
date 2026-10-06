import { adminActor } from '$lib/server/admin';
import { listAuditLogs } from '$lib/server/services/audit';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
	adminActor(locals);
	const q = (url.searchParams.get('q') ?? '').slice(0, 100);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const { rows, total } = listAuditLogs({ q, page, pageSize: PAGE_SIZE });
	return { title: 'Audit log', q, page, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
};
