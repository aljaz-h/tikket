import { describe, expect, it } from 'vitest';
import {
	capGroups,
	cardDate,
	groupCompleted,
	relativeOrDate,
	timelineAxis
} from '../../src/lib/shared/roadmap-view';

// Saturday 31 October 2026 (the week started Monday 26 October).
const now = new Date(2026, 9, 31, 12);
const day = (m: number, dd: number) => new Date(2026, m, dd, 10);
const abs = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;

describe('completed grouping and the cap', () => {
	const cards = [
		{ id: 1, completedAt: day(9, 30) },
		{ id: 2, completedAt: day(9, 27) },
		{ id: 3, completedAt: day(9, 22) },
		{ id: 4, completedAt: day(9, 14) },
		{ id: 5, completedAt: day(8, 20) },
		{ id: 6, completedAt: new Date(2025, 11, 1) }
	];
	it('groups by this week, last week and earlier months', () => {
		const groups = groupCompleted(cards, now);
		expect(groups.map((g) => [g.label, g.cards.map((c) => c.id)])).toEqual([
			['This week', [1, 2]],
			['Last week', [3]],
			['Earlier in October', [4]],
			['Earlier in September', [5]],
			['Earlier in December 2025', [6]]
		]);
	});
	it('fills groups in order and reports how many of a group are shown', () => {
		const capped = capGroups(groupCompleted(cards, now), 3);
		expect(capped.map((g) => [g.label, g.cards.length, g.total])).toEqual([
			['This week', 2, 2],
			['Last week', 1, 1]
		]);
		const partial = capGroups(groupCompleted(cards, now), 1);
		expect(partial.map((g) => [g.cards.length, g.total])).toEqual([[1, 2]]);
		expect(capGroups(groupCompleted(cards, now), null).flatMap((g) => g.cards)).toHaveLength(6);
	});
});

describe('dates on cards', () => {
	it('uses relative days for a week, then absolute dates', () => {
		expect(relativeOrDate(day(9, 31), now, abs)).toBe('today');
		expect(relativeOrDate(day(9, 30), now, abs)).toBe('yesterday');
		expect(relativeOrDate(day(9, 28), now, abs)).toBe('3d ago');
		expect(relativeOrDate(day(9, 24), now, abs)).toBe('10/24');
	});
	it('chooses the date for each status', () => {
		const base = {
			createdAt: day(9, 21),
			plannedAt: day(9, 25),
			startedAt: day(9, 28),
			completedAt: day(9, 30)
		};
		expect(cardDate({ ...base, status: 'open' }, now, abs).text).toBe('Created 10/21');
		expect(cardDate({ ...base, status: 'planned' }, now, abs).text).toBe('Planned 10/25');
		expect(cardDate({ ...base, status: 'in_progress' }, now, abs).text).toBe('Started 3d ago');
		expect(cardDate({ ...base, status: 'completed' }, now, abs).text).toBe('Done 10/30');
	});
});

describe('timeline axis', () => {
	it('runs from the first of the month to a week past today with Monday gridlines', () => {
		const axis = timelineAxis([day(9, 14), day(9, 30)], now);
		expect(axis.start).toEqual(new Date(2026, 9, 1));
		expect(axis.end).toEqual(new Date(2026, 10, 8));
		expect(axis.weeks.every((w) => w.at.getDay() === 1)).toBe(true);
		expect(axis.weeks).toHaveLength(5);
		expect(axis.todayPct).toBeGreaterThan(80);
		expect(axis.pct(new Date(2000, 0, 1))).toBe(0);
		expect(axis.pct(new Date(2100, 0, 1))).toBe(100);
	});
});
