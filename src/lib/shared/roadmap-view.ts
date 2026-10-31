/**
 * Pure presentation helpers for the roadmap page: grouping, the per-column card cap, the date
 * text on cards and the timeline's date axis. No data is changed here.
 */

export const COLUMN_CAP = 10;
const DAY = 864e5;
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

const d = (v: Date | string | number) => new Date(v);

/** Start of the (Monday-based) week containing `date`, local time. */
export function startOfWeek(date: Date): Date {
	const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
	return x;
}

export interface TimeGroup<T> {
	key: string;
	label: string;
	cards: T[];
}

/**
 * Groups completed tickets by completion date: "This week", "Last week", then one group per
 * earlier month ("Earlier in October"; with the year for other years). Newest first.
 */
export function groupCompleted<T extends { completedAt: Date | string | null }>(
	cards: T[],
	now: Date
): TimeGroup<T>[] {
	const thisWeek = startOfWeek(now).getTime();
	const lastWeek = thisWeek - 7 * DAY;
	const sorted = [...cards].sort(
		(a, b) => (b.completedAt ? +d(b.completedAt) : 0) - (a.completedAt ? +d(a.completedAt) : 0)
	);
	const groups: TimeGroup<T>[] = [];
	const bucket = (key: string, label: string) => {
		let g = groups.find((x) => x.key === key);
		if (!g) groups.push((g = { key, label, cards: [] }));
		return g;
	};
	for (const card of sorted) {
		const at = card.completedAt ? d(card.completedAt) : null;
		if (!at) bucket('earlier', 'Earlier').cards.push(card);
		else if (+at >= thisWeek) bucket('this-week', 'This week').cards.push(card);
		else if (+at >= lastWeek) bucket('last-week', 'Last week').cards.push(card);
		else {
			const sameYear = at.getFullYear() === now.getFullYear();
			bucket(
				`m-${at.getFullYear()}-${at.getMonth()}`,
				`Earlier in ${MONTHS[at.getMonth()]}${sameYear ? '' : ` ${at.getFullYear()}`}`
			).cards.push(card);
		}
	}
	return groups;
}

/**
 * Applies the column cap across groups in order, so the first group fills first. `total` is the
 * group's real size, `cards` what is shown.
 */
export function capGroups<T>(groups: TimeGroup<T>[], limit: number | null) {
	let left = limit ?? Infinity;
	return groups
		.map((g) => {
			const shown = g.cards.slice(0, Math.max(0, left));
			left -= shown.length;
			return { key: g.key, label: g.label, cards: shown, total: g.cards.length };
		})
		.filter((g) => g.cards.length > 0);
}

/** "Oct 25" (with the year when it is not the current one). */
export function shortDate(date: Date | string | number, now: Date): string {
	const at = d(date);
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
	}).format(at);
}

/** "today", "yesterday", "3d ago" within a week; an absolute date afterwards. */
export function relativeOrDate(
	date: Date | string | number,
	now: Date,
	absolute: (d: Date) => string
): string {
	const at = d(date);
	const days = Math.floor(
		(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
			new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) /
			DAY
	);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days}d ago`;
	return absolute(at);
}

export interface DatedCard {
	status: string;
	createdAt: Date | string;
	plannedAt: Date | string;
	startedAt: Date | string;
	completedAt: Date | string | null;
}

/** The date shown on a card (right of the meta row) for its status. */
export function cardDate(
	card: DatedCard,
	now: Date,
	absolute: (d: Date) => string
): { text: string; at: Date } {
	switch (card.status) {
		case 'planned':
			return { text: `Planned ${absolute(d(card.plannedAt))}`, at: d(card.plannedAt) };
		case 'in_progress':
			return {
				text: `Started ${relativeOrDate(card.startedAt, now, absolute)}`,
				at: d(card.startedAt)
			};
		case 'completed': {
			const at = d(card.completedAt ?? card.createdAt);
			return { text: `Done ${absolute(at)}`, at };
		}
		default:
			return { text: `Created ${absolute(d(card.createdAt))}`, at: d(card.createdAt) };
	}
}

/** Month label such as "October 2026" used by the Month grouping. */
export function monthKey(date: Date) {
	return {
		key: date.getFullYear() * 12 + date.getMonth(),
		label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
	};
}

export interface TimelineAxis {
	start: Date;
	end: Date;
	/** Position of a date on the track, 0–100 (clamped). */
	pct: (date: Date | string | number) => number;
	weeks: { at: Date; pct: number }[];
	todayPct: number;
}

/**
 * Date axis: from the first of the month of the earliest date (at most ~6 weeks back) to about
 * a week past today, with a gridline on every Monday.
 */
export function timelineAxis(dates: (Date | string | number)[], now: Date): TimelineAxis {
	const earliest = dates.length ? Math.min(...dates.map((x) => +d(x))) : +now;
	const floor = +now - 45 * DAY;
	const base = d(Math.max(earliest, floor));
	const start = new Date(base.getFullYear(), base.getMonth(), 1);
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8);
	const span = Math.max(1, +end - +start);
	const pct = (v: Date | string | number) =>
		Math.min(100, Math.max(0, ((+d(v) - +start) / span) * 100));
	const weeks: { at: Date; pct: number }[] = [];
	const first = startOfWeek(start);
	if (+first < +start) first.setDate(first.getDate() + 7);
	for (let w = new Date(first); +w <= +end; w.setDate(w.getDate() + 7))
		weeks.push({ at: new Date(w), pct: pct(w) });
	return { start, end, pct, weeks, todayPct: pct(now) };
}
