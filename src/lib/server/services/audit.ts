import { desc, eq, like, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { getDb, schema, type DB } from '../db';

export type AuditAction =
	| 'setup.completed'
	| 'user.created'
	| 'user.registered'
	| 'user.role_changed'
	| 'user.disabled'
	| 'user.enabled'
	| 'user.sessions_revoked'
	| 'user.password_reset_issued'
	| 'user.password_reset_used'
	| 'user.password_changed'
	| 'project.created'
	| 'project.updated'
	| 'project.archived'
	| 'project.unarchived'
	| 'project.key_changed'
	| 'project.visibility_changed'
	| 'project.member_added'
	| 'project.member_role_changed'
	| 'project.member_removed'
	| 'invitation.created'
	| 'invitation.revoked'
	| 'invitation.accepted'
	| 'settings.updated'
	| 'widget.updated'
	| 'project.logo';

export interface AuditEntry {
	actorId: number | null;
	action: AuditAction;
	targetType?: string;
	targetId?: string | number;
	data?: Record<string, unknown>;
	ip?: string | null;
}

export function audit(entry: AuditEntry, tx: Pick<DB, 'insert'> = getDb()) {
	tx.insert(schema.auditLogs)
		.values({
			actorId: entry.actorId,
			action: entry.action,
			targetType: entry.targetType ?? null,
			targetId: entry.targetId !== undefined ? String(entry.targetId) : null,
			data: entry.data ?? {},
			ipAddress: entry.ip ?? null
		})
		.run();
}

export function listAuditLogs(opts: { q?: string; page: number; pageSize: number }) {
	const db = getDb();
	const actor = alias(schema.users, 'actor');
	const where = opts.q
		? or(like(schema.auditLogs.action, `%${opts.q}%`), like(actor.username, `%${opts.q}%`))
		: undefined;
	const rows = db
		.select({
			id: schema.auditLogs.id,
			action: schema.auditLogs.action,
			targetType: schema.auditLogs.targetType,
			targetId: schema.auditLogs.targetId,
			data: schema.auditLogs.data,
			ipAddress: schema.auditLogs.ipAddress,
			createdAt: schema.auditLogs.createdAt,
			actorName: actor.displayName,
			actorUsername: actor.username
		})
		.from(schema.auditLogs)
		.leftJoin(actor, eq(actor.id, schema.auditLogs.actorId))
		.where(where)
		.orderBy(desc(schema.auditLogs.id))
		.limit(opts.pageSize)
		.offset((opts.page - 1) * opts.pageSize)
		.all();
	const total =
		db
			.select({ n: sql<number>`count(*)` })
			.from(schema.auditLogs)
			.leftJoin(actor, eq(actor.id, schema.auditLogs.actorId))
			.where(where)
			.get()?.n ?? 0;
	return { rows, total };
}
