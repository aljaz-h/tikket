import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { adminActor } from '$lib/server/admin';
import { formatWait, limiters } from '$lib/server/auth/rate-limit';
import { sendTestEmail } from '$lib/server/email/account';
import { saveSmtp, smtpForDisplay, smtpFormSchema, smtpFromEnv } from '$lib/server/email/config';
import { handleServiceError, intParam } from '$lib/server/http';
import { queueStats, recentProblems, retryJob } from '$lib/server/outbound/queue';
import { encryptionAvailable } from '$lib/server/secrets';
import { audit } from '$lib/server/services/audit';
import { zodErrors } from '$lib/server/validation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const admin = adminActor(locals);
	return {
		title: 'Email',
		smtp: smtpForDisplay(),
		envManaged: !!smtpFromEnv(),
		encryptionAvailable: encryptionAvailable(),
		stats: queueStats('email'),
		problems: recentProblems('email'),
		adminEmail: admin.email
	};
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const form = await request.formData();
		const values = Object.fromEntries(
			[...form.entries()].filter(([k]) => k !== 'password').map(([k, v]) => [k, String(v)])
		);
		const parsed = smtpFormSchema.safeParse({
			enabled: form.get('enabled') === 'on',
			host: form.get('host') ?? '',
			port: form.get('port') ?? '',
			security: form.get('security') ?? 'starttls',
			username: form.get('username') ?? '',
			fromName: form.get('fromName') ?? '',
			fromAddress: String(form.get('fromAddress') ?? '').trim(),
			replyTo: String(form.get('replyTo') ?? '').trim(),
			timeoutSec: form.get('timeoutSec') ?? '15'
		});
		if (!parsed.success) return fail(400, { errors: zodErrors(parsed.error), values });
		try {
			saveSmtp(
				admin.id,
				{
					...parsed.data,
					password: String(form.get('password') ?? ''),
					clearPassword: form.get('clearPassword') === 'on'
				},
				locals.clientIp
			);
		} catch (err) {
			return handleServiceError(err, values);
		}
		return { saved: true };
	},
	test: async ({ locals, request }) => {
		const admin = adminActor(locals);
		const wait = limiters.outboundTest.hit(`user:${admin.id}`);
		if (wait)
			return fail(429, { errors: { test: `Too many tests. Try again in ${formatWait(wait)}.` } });
		const to = String((await request.formData()).get('to') ?? '').trim();
		if (!z.email().safeParse(to).success)
			return fail(400, { errors: { test: 'Enter the address to send the test email to' } });
		const result = await sendTestEmail(to);
		audit({
			actorId: admin.id,
			action: 'settings.smtp_test',
			targetType: 'settings',
			targetId: 'smtp',
			data: { ok: result.ok },
			ip: locals.clientIp
		});
		return result.ok ? { tested: result.message } : fail(400, { errors: { test: result.message } });
	},
	retry: async ({ locals, request }) => {
		adminActor(locals);
		const id = intParam(String((await request.formData()).get('id') ?? ''));
		if (!id || !retryJob(id))
			return fail(404, { errors: { form: 'That delivery cannot be retried' } });
		return { retried: true };
	}
};
