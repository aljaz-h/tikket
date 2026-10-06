import type { RelationChoice } from './constants';

export interface RelationEdge {
	source: number;
	target: number;
}

/**
 * Would adding "from blocks to" create a cycle in the blocking graph? True when `from` is
 * already reachable from `to` (to → … → from), including the trivial self-loop.
 */
export function wouldCreateBlockingCycle(edges: RelationEdge[], from: number, to: number) {
	if (from === to) return true;
	const next = new Map<number, number[]>();
	for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
	const seen = new Set<number>([to]);
	const queue = [to];
	while (queue.length) {
		const id = queue.shift()!;
		for (const n of next.get(id) ?? []) {
			if (n === from) return true;
			if (!seen.has(n)) {
				seen.add(n);
				queue.push(n);
			}
		}
	}
	return false;
}

/** The same relationship seen from the other ticket. */
export function inverseRelation(choice: RelationChoice): RelationChoice {
	return choice === 'blocks' ? 'blocked_by' : choice === 'blocked_by' ? 'blocks' : 'relates';
}

/**
 * Stored form of a relationship chosen from `ticketId`'s point of view: "blocked by X" is
 * stored as "X blocks ticket"; "related to" is undirected and stored with the lower id first.
 */
export function storedRelation(ticketId: number, otherId: number, choice: RelationChoice) {
	if (choice === 'blocks') return { source: ticketId, target: otherId, kind: 'blocks' as const };
	if (choice === 'blocked_by')
		return { source: otherId, target: ticketId, kind: 'blocks' as const };
	return {
		source: Math.min(ticketId, otherId),
		target: Math.max(ticketId, otherId),
		kind: 'relates' as const
	};
}
