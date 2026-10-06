import {
	TICKET_PRIORITIES,
	TICKET_STATUSES,
	TICKET_TYPES,
	type TicketPriority,
	type TicketStatus,
	type TicketType
} from './constants';

export const SORTS = {
	updated: 'Recently updated (unresolved first)',
	recent: 'Recently updated',
	newest: 'Newest',
	oldest: 'Oldest',
	votes: 'Most requested',
	priority: 'Highest priority'
} as const;
export type SortKey = keyof typeof SORTS;

export interface TicketFilters {
	q: string;
	status: TicketStatus[];
	type: TicketType[];
	priority: TicketPriority[];
	reporter: string;
	assignee: string;
	labels: number[];
	createdFrom: string;
	createdTo: string;
	updatedFrom: string;
	updatedTo: string;
	sort: SortKey;
	page: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function list<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): T[] {
	const values = params.getAll(key).flatMap((v) => v.split(','));
	return [...new Set(values.filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}

export function parseTicketFilters(params: URLSearchParams): TicketFilters {
	const sort = params.get('sort') ?? 'updated';
	const page = Number.parseInt(params.get('page') ?? '1', 10);
	const date = (key: string) => {
		const v = params.get(key) ?? '';
		return DATE_RE.test(v) ? v : '';
	};
	return {
		q: (params.get('q') ?? '').trim().slice(0, 200),
		status: list(params, 'status', TICKET_STATUSES),
		type: list(params, 'type', TICKET_TYPES),
		priority: list(params, 'priority', TICKET_PRIORITIES),
		reporter: (params.get('reporter') ?? '').trim().slice(0, 40),
		assignee: (params.get('assignee') ?? '').trim().slice(0, 40),
		labels: params
			.getAll('label')
			.flatMap((v) => v.split(','))
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0),
		createdFrom: date('createdFrom'),
		createdTo: date('createdTo'),
		updatedFrom: date('updatedFrom'),
		updatedTo: date('updatedTo'),
		sort: sort in SORTS ? (sort as SortKey) : 'updated',
		page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1
	};
}

/** Number of filters (excluding search, sort and page) currently applied. */
export function activeFilterCount(f: TicketFilters): number {
	return (
		f.status.length +
		f.type.length +
		f.priority.length +
		f.labels.length +
		(f.reporter ? 1 : 0) +
		(f.assignee ? 1 : 0) +
		(f.createdFrom || f.createdTo ? 1 : 0) +
		(f.updatedFrom || f.updatedTo ? 1 : 0)
	);
}

/** Serialises filters back to a query string, omitting defaults. */
export function filtersToParams(
	f: Partial<TicketFilters>,
	extra: Record<string, string> = {}
): URLSearchParams {
	const p = new URLSearchParams();
	if (f.q) p.set('q', f.q);
	for (const s of f.status ?? []) p.append('status', s);
	for (const t of f.type ?? []) p.append('type', t);
	for (const pr of f.priority ?? []) p.append('priority', pr);
	for (const l of f.labels ?? []) p.append('label', String(l));
	if (f.reporter) p.set('reporter', f.reporter);
	if (f.assignee) p.set('assignee', f.assignee);
	if (f.createdFrom) p.set('createdFrom', f.createdFrom);
	if (f.createdTo) p.set('createdTo', f.createdTo);
	if (f.updatedFrom) p.set('updatedFrom', f.updatedFrom);
	if (f.updatedTo) p.set('updatedTo', f.updatedTo);
	if (f.sort && f.sort !== 'updated') p.set('sort', f.sort);
	if (f.page && f.page > 1) p.set('page', String(f.page));
	for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
	return p;
}

const STOP_WORDS = new Set(
	'a an and are as at be but by for from has have i in is it its of on or that the this to was were when with not no doesnt dont isnt cant after before'.split(
		' '
	)
);

/**
 * Builds a safe FTS5 MATCH expression from free text. Every token is quoted, so user input can
 * never inject FTS syntax. `any` mode ORs the tokens (used for duplicate suggestions).
 */
export function toFtsQuery(text: string, mode: 'all' | 'any' = 'all'): string | null {
	const tokens = (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
		.filter((t) => (mode === 'any' ? t.length > 2 && !STOP_WORDS.has(t) : true))
		.slice(0, 12);
	if (!tokens.length) return null;
	const quoted = [...new Set(tokens)].map((t) => `"${t}"*`);
	return quoted.join(mode === 'any' ? ' OR ' : ' ');
}
