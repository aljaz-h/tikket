import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	TEMPLATE_FIELD_KINDS,
	TICKET_TYPES,
	type TemplateAnswer,
	type TicketType
} from '../../shared/constants';
import { slugKey, TEMPLATE_LIMITS, type TemplateFieldDef } from '../../shared/templates';
import { getDb, schema, type DB } from '../db';
import type { Project } from '../db/schema';
import { ServiceError } from './users';

export interface TemplateWithFields {
	id: number;
	type: TicketType;
	name: string;
	description: string | null;
	enabled: boolean;
	isDefault: boolean;
	version: number;
	updatedAt: Date;
	fields: (TemplateFieldDef & { id: number })[];
}

const fieldSchema = z
	.object({
		key: z
			.string()
			.regex(/^[a-z0-9_]{1,40}$/)
			.optional()
			.or(z.literal('')),
		kind: z.enum(TEMPLATE_FIELD_KINDS),
		label: z.string().trim().min(1, 'Every question needs a label').max(120),
		help: z.string().trim().max(300).nullish(),
		placeholder: z.string().trim().max(120).nullish(),
		required: z.boolean().default(false),
		options: z.array(z.string().trim().min(1).max(80)).max(TEMPLATE_LIMITS.options).default([])
	})
	.refine((f) => f.kind !== 'select' || f.options.length >= 2, {
		message: 'A dropdown needs at least two options',
		path: ['options']
	})
	.refine((f) => new Set(f.options).size === f.options.length, {
		message: 'Dropdown options must be unique',
		path: ['options']
	});

export const templateSchema = z.object({
	id: z.number().int().positive().optional(),
	type: z.enum(TICKET_TYPES),
	name: z.string().trim().min(1, 'Name the template').max(80),
	description: z.string().trim().max(300).nullish(),
	enabled: z.boolean(),
	isDefault: z.boolean(),
	fields: z
		.array(fieldSchema)
		.max(TEMPLATE_LIMITS.fields, `At most ${TEMPLATE_LIMITS.fields} questions`)
});
export type TemplateInput = z.infer<typeof templateSchema>;

function loadFields(templateIds: number[]) {
	if (!templateIds.length) return [];
	return getDb()
		.select()
		.from(schema.ticketTemplateFields)
		.where(inArray(schema.ticketTemplateFields.templateId, templateIds))
		.orderBy(asc(schema.ticketTemplateFields.position), asc(schema.ticketTemplateFields.id))
		.all();
}

export function listTemplates(
	projectId: number,
	opts: { activeOnly?: boolean } = {}
): TemplateWithFields[] {
	const t = schema.ticketTemplates;
	const rows = getDb()
		.select()
		.from(t)
		.where(
			and(
				eq(t.projectId, projectId),
				isNull(t.deletedAt),
				opts.activeOnly ? eq(t.enabled, true) : undefined
			)
		)
		.orderBy(asc(t.type), sql`${t.isDefault} desc`, asc(t.name))
		.all();
	const fields = loadFields(rows.map((r) => r.id));
	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		name: r.name,
		description: r.description,
		enabled: r.enabled,
		isDefault: r.isDefault,
		version: r.version,
		updatedAt: r.updatedAt,
		fields: fields
			.filter((f) => f.templateId === r.id)
			.map((f) => ({
				id: f.id,
				key: f.key,
				kind: f.kind,
				label: f.label,
				help: f.help,
				placeholder: f.placeholder,
				required: f.required,
				options: f.options
			}))
	}));
}

export function getTemplate(projectId: number, id: number): TemplateWithFields | undefined {
	return listTemplates(projectId).find((t) => t.id === id);
}

/** Creates or updates a template. Every update bumps the version; field keys stay stable. */
export function saveTemplate(project: Project, input: TemplateInput): number {
	return getDb().transaction(
		(tx) => {
			const t = schema.ticketTemplates;
			let id = input.id;
			const now = new Date();
			if (id) {
				const existing = tx
					.select()
					.from(t)
					.where(and(eq(t.id, id), eq(t.projectId, project.id), isNull(t.deletedAt)))
					.get();
				if (!existing) throw new ServiceError('Template not found', 'form', 404);
				tx.update(t)
					.set({
						type: input.type,
						name: input.name,
						description: input.description ?? null,
						enabled: input.enabled,
						isDefault: input.isDefault,
						version: existing.version + 1,
						updatedAt: now
					})
					.where(eq(t.id, id))
					.run();
				tx.delete(schema.ticketTemplateFields)
					.where(eq(schema.ticketTemplateFields.templateId, id))
					.run();
			} else {
				id = tx
					.insert(t)
					.values({
						projectId: project.id,
						type: input.type,
						name: input.name,
						description: input.description ?? null,
						enabled: input.enabled,
						isDefault: input.isDefault
					})
					.returning({ id: t.id })
					.get().id;
			}
			if (input.isDefault)
				tx.update(t)
					.set({ isDefault: false })
					.where(and(eq(t.projectId, project.id), eq(t.type, input.type), ne(t.id, id)))
					.run();
			const taken = new Set(input.fields.map((f) => f.key).filter((k): k is string => !!k));
			if (taken.size !== input.fields.filter((f) => f.key).length)
				throw new ServiceError('Duplicate question keys', 'fields');
			if (input.fields.length)
				tx.insert(schema.ticketTemplateFields)
					.values(
						input.fields.map((f, position) => ({
							templateId: id!,
							key: f.key || slugKey(f.label, taken),
							kind: f.kind,
							label: f.label,
							help: f.help || null,
							placeholder:
								f.kind === 'checkbox' || f.kind === 'select' ? null : f.placeholder || null,
							required: f.required,
							options: f.kind === 'select' ? f.options : [],
							position
						}))
					)
					.run();
			return id!;
		},
		{ behavior: 'immediate' }
	);
}

/** Soft-deletes a template; tickets keep their own snapshot of questions and answers. */
export function deleteTemplate(projectId: number, id: number) {
	const t = schema.ticketTemplates;
	return getDb()
		.update(t)
		.set({ deletedAt: new Date(), enabled: false, isDefault: false })
		.where(and(eq(t.id, id), eq(t.projectId, projectId), isNull(t.deletedAt)))
		.run().changes;
}

/** Templates offered for new tickets: enabled ones, the default first for each type. */
export function activeTemplates(projectId: number) {
	return listTemplates(projectId, { activeOnly: true }).map(
		({ id, type, name, description, isDefault, version, fields }) => ({
			id,
			type,
			name,
			description,
			isDefault,
			version,
			fields
		})
	);
}
export type ActiveTemplate = ReturnType<typeof activeTemplates>[number];

/** Picks the submitted template if it is active for the project and type. */
export function resolveTemplate(
	projectId: number,
	type: TicketType,
	templateId: number | null
): ActiveTemplate | null {
	const candidates = activeTemplates(projectId).filter((t) => t.type === type);
	if (!candidates.length) return null;
	return (
		candidates.find((t) => t.id === templateId) ??
		candidates.find((t) => t.isDefault) ??
		candidates[0]
	);
}

export interface TemplateResponseInput {
	templateId: number;
	templateName: string;
	templateVersion: number;
	answers: TemplateAnswer[];
}

export function saveTemplateResponse(tx: DB, ticketId: number, input: TemplateResponseInput) {
	tx.insert(schema.ticketTemplateResponses)
		.values({ ticketId, ...input })
		.run();
}

export function getTemplateResponse(ticketId: number) {
	return getDb()
		.select()
		.from(schema.ticketTemplateResponses)
		.where(eq(schema.ticketTemplateResponses.ticketId, ticketId))
		.get();
}
