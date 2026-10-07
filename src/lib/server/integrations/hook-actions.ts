import { fail, type RequestEvent } from '@sveltejs/kit';
import type { HookKind } from '../../shared/constants';
import { requireProject } from '../authz';
import { formatWait, limiters } from '../auth/rate-limit';
import { handleServiceError, intParam, requireActionUser } from '../http';
import { encryptionAvailable } from '../secrets';
import { privateNetworksAllowed } from '../safe-fetch';
import { getSettings } from '../settings';
import { sendTestDelivery } from './delivery';
import {
	createHook,
	deleteHook,
	getHook,
	hookInput,
	listHooks,
	recentDeliveries,
	requireIntegrationManager,
	rotateHookSecret,
	updateHook
} from './hooks';

/** Page data for the Discord and Webhooks settings pages (no URLs or secrets). */
export function loadHooks(locals: App.Locals, key: string, kind: HookKind) {
	const access = requireProject(locals.user, key, 'owner');
	const hooks = listHooks(access.project.id, kind);
	const deliveries = recentDeliveries(hooks.map((h) => h.id));
	return {
		hooks: hooks.map((h) => ({
			...h,
			deliveries: deliveries
				.filter((d) => d.hookId === h.id)
				.slice(0, 15)
				.map((d) => ({
					id: d.id,
					event: d.event,
					eventId: d.eventId,
					attempt: d.attempt,
					statusCode: d.statusCode,
					durationMs: d.durationMs,
					success: d.success,
					error: d.error,
					createdAt: d.createdAt
				}))
		})),
		encryptionAvailable: encryptionAvailable(),
		privateNetworksAllowed: privateNetworksAllowed(),
		archived: access.archived
	};
}

function readForm(form: FormData) {
	return hookInput.safeParse({
		name: String(form.get('name') ?? ''),
		url: String(form.get('url') ?? '').trim() || undefined,
		events: form.getAll('events').map(String),
		enabled: form.get('enabled') === 'on'
	});
}

/** Form actions shared by the Discord and Webhooks settings pages. */
export function hookActions(kind: HookKind) {
	const owner = (event: RequestEvent) => {
		const user = requireActionUser(event.locals);
		const access = requireProject(user, event.params.key!, 'owner');
		return { user, access };
	};
	return {
		create: async (event: RequestEvent) => {
			const { user, access } = owner(event);
			const form = await event.request.formData();
			const values = { name: String(form.get('name') ?? '') };
			const parsed = readForm(form);
			if (!parsed.success)
				return fail(400, {
					errors: {
						[String(parsed.error.issues[0].path[0] ?? 'form')]: parsed.error.issues[0].message
					},
					values
				});
			try {
				const { secret } = createHook(user.id, access, kind, parsed.data, event.locals.clientIp);
				return { created: true, secret };
			} catch (err) {
				return handleServiceError(err, values);
			}
		},
		update: async (event: RequestEvent) => {
			const { user, access } = owner(event);
			const form = await event.request.formData();
			const id = intParam(String(form.get('id') ?? ''));
			const parsed = readForm(form);
			if (!id) return fail(400, { errors: { form: 'Unknown integration' } });
			if (!parsed.success)
				return fail(400, {
					errors: {
						[String(parsed.error.issues[0].path[0] ?? 'form')]: parsed.error.issues[0].message
					},
					editId: id
				});
			try {
				updateHook(user.id, access, kind, id, parsed.data, event.locals.clientIp);
			} catch (err) {
				return handleServiceError(err);
			}
			return { updated: true };
		},
		rotate: async (event: RequestEvent) => {
			const { user, access } = owner(event);
			const id = intParam(String((await event.request.formData()).get('id') ?? ''));
			if (!id) return fail(400, { errors: { form: 'Unknown integration' } });
			try {
				return {
					secret: rotateHookSecret(user.id, access, id, event.locals.clientIp),
					rotatedId: id
				};
			} catch (err) {
				return handleServiceError(err);
			}
		},
		delete: async (event: RequestEvent) => {
			const { user, access } = owner(event);
			const id = intParam(String((await event.request.formData()).get('id') ?? ''));
			if (!id) return fail(400, { errors: { form: 'Unknown integration' } });
			try {
				deleteHook(user.id, access, kind, id, event.locals.clientIp);
			} catch (err) {
				return handleServiceError(err);
			}
			return { deleted: true };
		},
		test: async (event: RequestEvent) => {
			const { user, access } = owner(event);
			try {
				requireIntegrationManager(access);
			} catch (err) {
				return handleServiceError(err);
			}
			const wait = limiters.outboundTest.hit(`user:${user.id}`);
			if (wait)
				return fail(429, { errors: { form: `Too many tests. Try again in ${formatWait(wait)}.` } });
			const id = intParam(String((await event.request.formData()).get('id') ?? ''));
			const hook = id ? getHook(access.project.id, id) : undefined;
			if (!hook || hook.kind !== kind)
				return fail(404, { errors: { form: 'Unknown integration' } });
			const result = await sendTestDelivery(hook, access.project, getSettings().appName);
			return result.ok
				? { tested: `Test delivered (HTTP ${result.statusCode}, ${result.durationMs} ms)` }
				: fail(400, { errors: { form: `Test failed: ${result.error}` } });
		}
	};
}
