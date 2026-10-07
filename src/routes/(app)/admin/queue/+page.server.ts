import { adminActor } from '$lib/server/admin';
import { handleServiceError, intParam } from '$lib/server/http';
import {
	discardJob,
	isJobKind,
	jobDetails,
	listQueueJobs,
	queueOverview,
	retryNow,
	type QueueFilter
} from '$lib/server/outbound/admin';
import type { Actions, PageServerLoad } from './$types';

const FILTERS: QueueFilter[] = ['failed', 'retrying', 'pending'];

export const load: PageServerLoad = async ({ locals, url }) => {
	adminActor(locals);
	const q = url.searchParams;
	const filter = (FILTERS as string[]).includes(q.get('show') ?? '')
		? (q.get('show') as QueueFilter)
		: 'failed';
	const kind = q.get('kind');
	const detailId = intParam(q.get('job'));
	return {
		title: 'Delivery queue',
		overview: queueOverview(),
		filter,
		kind: isJobKind(kind) ? kind : '',
		...listQueueJobs({
			filter,
			kind: isJobKind(kind) ? kind : null,
			before: intParam(q.get('before'))
		}),
		detail: detailId ? jobDetails(detailId) : null
	};
};

export const actions: Actions = {
	retry: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const id = intParam(String((await request.formData()).get('id') ?? ''));
		try {
			retryNow(admin.id, id ?? 0, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { retried: true };
	},
	discard: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const id = intParam(String((await request.formData()).get('id') ?? ''));
		try {
			discardJob(admin.id, id ?? 0, locals.clientIp);
		} catch (err) {
			return handleServiceError(err);
		}
		return { discarded: true };
	}
};
