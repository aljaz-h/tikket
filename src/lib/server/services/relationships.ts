import { and, eq, or } from 'drizzle-orm';
import { RELATION_CHOICES, type RelationChoice, type TicketStatus } from '../../shared/constants';
import { inverseRelation, storedRelation, wouldCreateBlockingCycle } from '../../shared/relations';
import { parseTicketReference } from '../../shared/workflow';
import type { Actor, ProjectAccess } from '../authz';
import { getDb, schema } from '../db';
import type { Ticket } from '../db/schema';
import { ServiceError } from './users';
import { addActivity, getTicket } from './tickets';

type ActiveActor = NonNullable<Actor>;

export interface RelatedTicket {
	id: number;
	relation: RelationChoice;
	ticket: { id: number; number: number; title: string; status: TicketStatus };
}

/** Relationships of a ticket, each expressed from this ticket's point of view. */
export function listRelationships(ticketId: number): RelatedTicket[] {
	const db = getDb();
	const rels = db
		.select()
		.from(schema.ticketRelationships)
		.where(
			or(
				eq(schema.ticketRelationships.sourceTicketId, ticketId),
				eq(schema.ticketRelationships.targetTicketId, ticketId)
			)
		)
		.all();
	const out: RelatedTicket[] = [];
	for (const r of rels) {
		const outgoing = r.sourceTicketId === ticketId;
		const otherId = outgoing ? r.targetTicketId : r.sourceTicketId;
		const other = db
			.select({
				id: schema.tickets.id,
				number: schema.tickets.number,
				title: schema.tickets.title,
				status: schema.tickets.status
			})
			.from(schema.tickets)
			.where(eq(schema.tickets.id, otherId))
			.get();
		if (!other) continue;
		const relation: RelationChoice =
			r.kind === 'relates' ? 'relates' : outgoing ? 'blocks' : 'blocked_by';
		out.push({ id: r.id, relation, ticket: other });
	}
	const order: RelationChoice[] = ['blocked_by', 'blocks', 'relates'];
	return out.sort(
		(a, b) =>
			order.indexOf(a.relation) - order.indexOf(b.relation) || a.ticket.number - b.ticket.number
	);
}

function requireStaff(access: ProjectAccess) {
	if (!access.isStaff || access.archived)
		throw new ServiceError('Only project staff can link tickets', 'relation', 403);
}

export function addRelationship(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	choice: RelationChoice,
	reference: string
) {
	requireStaff(access);
	if (!(choice in RELATION_CHOICES)) throw new ServiceError('Choose a relationship', 'relation');
	const number = parseTicketReference(reference, access.project.key);
	// Lookups are scoped to this project: other projects' tickets cannot be referenced.
	const other = number ? getTicket(ticket.projectId, number) : undefined;
	if (!other)
		throw new ServiceError(`No ticket ${reference || ''} in this project`.trim(), 'relation');
	if (other.id === ticket.id)
		throw new ServiceError('A ticket cannot be linked to itself', 'relation');

	const stored = storedRelation(ticket.id, other.id, choice);
	getDb().transaction(
		(tx) => {
			const existing = tx
				.select({ id: schema.ticketRelationships.id })
				.from(schema.ticketRelationships)
				.where(
					or(
						and(
							eq(schema.ticketRelationships.sourceTicketId, ticket.id),
							eq(schema.ticketRelationships.targetTicketId, other.id)
						),
						and(
							eq(schema.ticketRelationships.sourceTicketId, other.id),
							eq(schema.ticketRelationships.targetTicketId, ticket.id)
						)
					)
				)
				.get();
			if (existing) throw new ServiceError('These tickets are already linked', 'relation', 409);
			if (stored.kind === 'blocks') {
				const edges = tx
					.select({
						source: schema.ticketRelationships.sourceTicketId,
						target: schema.ticketRelationships.targetTicketId
					})
					.from(schema.ticketRelationships)
					.where(eq(schema.ticketRelationships.kind, 'blocks'))
					.all();
				if (wouldCreateBlockingCycle(edges, stored.source, stored.target))
					throw new ServiceError(
						'That would create a blocking cycle (tickets blocking each other)',
						'relation'
					);
			}
			tx.insert(schema.ticketRelationships)
				.values({
					sourceTicketId: stored.source,
					targetTicketId: stored.target,
					kind: stored.kind,
					createdById: actor.id
				})
				.run();
			addActivity(tx, ticket.id, actor.id, 'relation_added', {
				relation: choice,
				number: other.number,
				title: other.title
			});
			addActivity(tx, other.id, actor.id, 'relation_added', {
				relation: inverseRelation(choice),
				number: ticket.number,
				title: ticket.title
			});
		},
		{ behavior: 'immediate' }
	);
}

export function removeRelationship(
	actor: ActiveActor,
	access: ProjectAccess,
	ticket: Ticket,
	relationshipId: number
) {
	requireStaff(access);
	const related = listRelationships(ticket.id).find((r) => r.id === relationshipId);
	if (!related) throw new ServiceError('Relationship not found', 'relation', 404);
	getDb().transaction((tx) => {
		tx.delete(schema.ticketRelationships)
			.where(eq(schema.ticketRelationships.id, relationshipId))
			.run();
		addActivity(tx, ticket.id, actor.id, 'relation_removed', {
			relation: related.relation,
			number: related.ticket.number,
			title: related.ticket.title
		});
		addActivity(tx, related.ticket.id, actor.id, 'relation_removed', {
			relation: inverseRelation(related.relation),
			number: ticket.number,
			title: ticket.title
		});
	});
}
