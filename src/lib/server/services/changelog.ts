import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { ServiceError } from './users';

export interface ChangelogInput {
	version: string;
	releaseDate: string;
	summaryHtml: string;
	published: boolean;
	ticketIds: number[];
}

/** Changelog entries with their linked tickets; drafts only for staff. */
export function listChangelog(projectId: number, includeDrafts: boolean) {
	const db = getDb();
	const entries = db
		.select()
		.from(schema.changelogEntries)
		.where(
			and(
				eq(schema.changelogEntries.projectId, projectId),
				includeDrafts ? undefined : eq(schema.changelogEntries.published, true)
			)
		)
		.orderBy(desc(schema.changelogEntries.releaseDate), desc(schema.changelogEntries.id))
		.all();
	if (!entries.length) return [];
	const links = db
		.select({
			entryId: schema.changelogTicketLinks.entryId,
			id: schema.tickets.id,
			number: schema.tickets.number,
			title: schema.tickets.title,
			type: schema.tickets.type,
			status: schema.tickets.status
		})
		.from(schema.changelogTicketLinks)
		.innerJoin(schema.tickets, eq(schema.tickets.id, schema.changelogTicketLinks.ticketId))
		.where(
			inArray(
				schema.changelogTicketLinks.entryId,
				entries.map((e) => e.id)
			)
		)
		.all();
	return entries.map((e) => ({ ...e, tickets: links.filter((l) => l.entryId === e.id) }));
}

export function completedTickets(projectId: number) {
	return getDb()
		.select({
			id: schema.tickets.id,
			number: schema.tickets.number,
			title: schema.tickets.title,
			type: schema.tickets.type,
			completedAt: schema.tickets.completedAt
		})
		.from(schema.tickets)
		.where(and(eq(schema.tickets.projectId, projectId), eq(schema.tickets.status, 'completed')))
		.orderBy(desc(schema.tickets.completedAt))
		.limit(300)
		.all();
}

function validTicketIds(projectId: number, ids: number[]) {
	if (!ids.length) return [];
	return getDb()
		.select({ id: schema.tickets.id })
		.from(schema.tickets)
		.where(
			and(
				eq(schema.tickets.projectId, projectId),
				eq(schema.tickets.status, 'completed'),
				inArray(schema.tickets.id, ids)
			)
		)
		.all()
		.map((r) => r.id);
}

export function saveChangelogEntry(
	projectId: number,
	actorId: number,
	input: ChangelogInput,
	entryId?: number
) {
	const ticketIds = validTicketIds(projectId, input.ticketIds);
	return getDb().transaction((tx) => {
		let id = entryId;
		const values = {
			version: input.version,
			releaseDate: input.releaseDate,
			summaryHtml: input.summaryHtml,
			published: input.published,
			updatedAt: new Date()
		};
		if (id) {
			const res = tx
				.update(schema.changelogEntries)
				.set(values)
				.where(
					and(eq(schema.changelogEntries.id, id), eq(schema.changelogEntries.projectId, projectId))
				)
				.run();
			if (!res.changes) throw new ServiceError('Changelog entry not found', 'form', 404);
			tx.delete(schema.changelogTicketLinks)
				.where(eq(schema.changelogTicketLinks.entryId, id))
				.run();
		} else {
			id = tx
				.insert(schema.changelogEntries)
				.values({ ...values, projectId, createdById: actorId })
				.returning()
				.get().id;
		}
		if (ticketIds.length)
			tx.insert(schema.changelogTicketLinks)
				.values(ticketIds.map((ticketId) => ({ entryId: id!, ticketId })))
				.run();
		return id!;
	});
}

export function deleteChangelogEntry(projectId: number, entryId: number) {
	return getDb()
		.delete(schema.changelogEntries)
		.where(
			and(eq(schema.changelogEntries.id, entryId), eq(schema.changelogEntries.projectId, projectId))
		)
		.run().changes;
}
