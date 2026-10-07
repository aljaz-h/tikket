import { fail, type ActionFailure } from '@sveltejs/kit';
import { z } from 'zod';
import {
	CONTEXT_KEYS,
	EDIT_POLICIES,
	GLOBAL_ROLES,
	PROJECT_COLORS,
	PROJECT_ROLES,
	RELEASE_STATUSES,
	SUBMISSION_POLICIES,
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES,
	VISIBILITIES
} from '../shared/constants';
import { safeHttpUrl } from '../shared/text';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth/password';

export type FieldErrors = Record<string, string>;

const checkbox = z
	.string()
	.optional()
	.transform((v) => v === 'on' || v === 'true' || v === '1');

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max, `Must be at most ${max} characters`)
		.optional()
		.transform((v) => (v ? v : null));

const optionalUrl = z
	.string()
	.trim()
	.max(2048)
	.optional()
	.transform((v, ctx) => {
		if (!v) return null;
		const url = safeHttpUrl(/^https?:\/\//i.test(v) ? v : `https://${v}`);
		if (!url) {
			ctx.addIssue({ code: 'custom', message: 'Enter a valid http(s) URL' });
			return z.NEVER;
		}
		return url;
	});

export const username = z
	.string()
	.trim()
	.min(2, 'Username must be at least 2 characters')
	.max(32, 'Username must be at most 32 characters')
	.regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/, 'Use letters, numbers, dots, dashes and underscores');

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email'));

export const password = z
	.string()
	.min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
	.max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const displayName = z
	.string()
	.trim()
	.min(1, 'Display name is required')
	.max(60, 'Display name must be at most 60 characters');

export const accountSchema = z
	.object({
		username,
		email,
		displayName,
		password,
		confirmPassword: z.string()
	})
	.refine((d) => d.password === d.confirmPassword, {
		path: ['confirmPassword'],
		message: 'Passwords do not match'
	});

export const loginSchema = z.object({
	identifier: z.string().trim().min(1, 'Enter your username or email').max(254),
	password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH)
});

export const changePasswordSchema = z
	.object({
		currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
		newPassword: password,
		confirmPassword: z.string()
	})
	.refine((d) => d.newPassword === d.confirmPassword, {
		path: ['confirmPassword'],
		message: 'Passwords do not match'
	});

export const resetPasswordSchema = z
	.object({ newPassword: password, confirmPassword: z.string() })
	.refine((d) => d.newPassword === d.confirmPassword, {
		path: ['confirmPassword'],
		message: 'Passwords do not match'
	});

export const profileSchema = z.object({
	displayName,
	username,
	email,
	bio: optionalText(280)
});

export const projectKey = z
	.string()
	.trim()
	.toUpperCase()
	.regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2–10 letters or digits, starting with a letter');

export const projectSchema = z.object({
	name: z.string().trim().min(1, 'Project name is required').max(80),
	key: projectKey,
	description: optionalText(500),
	icon: optionalText(16),
	color: z.enum(PROJECT_COLORS).default('indigo'),
	url: optionalUrl,
	/** Optional support / documentation link. */
	docsUrl: optionalUrl,
	/** Optional brand accent (#rrggbb); text on it is chosen automatically for contrast. */
	accentColor: z
		.string()
		.trim()
		.optional()
		.transform((v, ctx) => {
			if (!v) return null;
			if (!/^#[0-9a-f]{6}$/i.test(v)) {
				ctx.addIssue({ code: 'custom', message: 'Use a hex colour such as #b8f779' });
				return z.NEVER;
			}
			return v.toLowerCase();
		}),
	visibility: z.enum(VISIBILITIES),
	allowAnonymousRead: checkbox
});

export const projectSettingsSchema = projectSchema.extend({
	submissionPolicy: z.enum(SUBMISSION_POLICIES),
	votingEnabled: checkbox,
	attachmentsEnabled: checkbox,
	commentsEnabled: checkbox,
	editPolicy: z.enum(EDIT_POLICIES)
});

export const ticketContextSchema = z
	.object(
		Object.fromEntries(
			CONTEXT_KEYS.map((k) => [k, z.string().trim().max(5000).optional()])
		) as Record<(typeof CONTEXT_KEYS)[number], z.ZodOptional<z.ZodString>>
	)
	.transform((ctx, issueCtx) => {
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(ctx)) {
			if (!value) continue;
			if (key === 'affectedUrl') {
				const url = safeHttpUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`);
				if (!url) {
					issueCtx.addIssue({
						code: 'custom',
						path: ['affectedUrl'],
						message: 'Enter a valid http(s) URL'
					});
					continue;
				}
				out[key] = url;
			} else out[key] = value;
		}
		return out;
	});

export const ticketInputSchema = z.object({
	type: z.enum(TICKET_TYPES, { message: 'Choose what you would like to report' }),
	title: z
		.string()
		.trim()
		.min(4, 'Give your ticket a short title (at least 4 characters)')
		.max(160, 'Keep the title under 160 characters'),
	description: z.string().max(100_000, 'The description is too long'),
	descriptionFormat: z.enum(['html', 'text']).default('text')
});

export const commentSchema = z.object({
	body: z.string().max(50_000, 'The comment is too long'),
	bodyFormat: z.enum(['html', 'text']).default('text')
});

export const statusSchema = z.object({
	status: z.enum(TICKET_STATUSES),
	note: optionalText(2000),
	duplicateOf: z.string().trim().max(32).optional()
});

export const prioritySchema = z.object({ priority: z.enum(TICKET_PRIORITIES) });

export const globalRoleSchema = z.enum(GLOBAL_ROLES);
export const projectRoleSchema = z.enum(PROJECT_ROLES);

const optionalDate = z
	.string()
	.trim()
	.transform((v) => v || null)
	.pipe(
		z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
			.nullable()
	);

export const releaseSchema = z.object({
	version: z.string().trim().min(1, 'Version or release name is required').max(60),
	targetDate: optionalDate.default(''),
	status: z.enum(RELEASE_STATUSES).default('planned'),
	summary: z.string().max(50_000).default(''),
	summaryFormat: z.enum(['html', 'text']).default('text')
});

export const milestoneSchema = z.object({
	name: z.string().trim().min(1, 'Name the milestone').max(80),
	description: z
		.string()
		.trim()
		.max(2000)
		.default('')
		.transform((v) => v || null),
	targetDate: optionalDate.default('')
});

/** Collects scalar form entries into a plain object (last value wins). */
export function formToObject(form: FormData): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of form.entries()) if (typeof value === 'string') out[key] = value;
	return out;
}

export function zodErrors(error: z.ZodError): FieldErrors {
	const errors: FieldErrors = {};
	for (const issue of error.issues) {
		const key = issue.path.join('.') || 'form';
		errors[key] ??= issue.message;
	}
	return errors;
}

type Parsed<T> =
	| { ok: true; data: T }
	| { ok: false; failure: ActionFailure<{ errors: FieldErrors; values: Record<string, string> }> };

/** Parses form data with a schema, producing an ActionFailure that keeps the user's input. */
export function parseForm<S extends z.ZodType>(
	schema: S,
	form: FormData,
	omitFromValues: string[] = ['password', 'confirmPassword', 'currentPassword', 'newPassword']
): Parsed<z.infer<S>> {
	const raw = formToObject(form);
	const result = schema.safeParse(raw);
	if (result.success) return { ok: true, data: result.data };
	const values = { ...raw };
	for (const key of omitFromValues) delete values[key];
	return { ok: false, failure: fail(400, { errors: zodErrors(result.error), values }) };
}

export function formError(message: string, status = 400, values: Record<string, string> = {}) {
	return fail(status, { errors: { form: message } as FieldErrors, values });
}
