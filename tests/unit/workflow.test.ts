import { describe, expect, it } from 'vitest';
import {
	parseTicketReference,
	statusEffect,
	validateStatusChange
} from '../../src/lib/shared/workflow';

const ticket = { id: 1, projectId: 1, status: 'open' as const };

describe('validateStatusChange', () => {
	it('allows moving between any two different statuses', () => {
		expect(validateStatusChange(ticket, 'planned')).toBeNull();
		expect(validateStatusChange({ ...ticket, status: 'completed' }, 'open')).toBeNull();
	});
	it('rejects no-op transitions', () => {
		expect(validateStatusChange(ticket, 'open')).toMatch(/already/);
	});
	it('requires a valid duplicate target in the same project', () => {
		expect(validateStatusChange(ticket, 'duplicate', null)).toMatch(/duplicates/);
		expect(
			validateStatusChange(ticket, 'duplicate', {
				id: 2,
				projectId: 9,
				status: 'open',
				duplicateOfId: null
			})
		).toMatch(/same project/);
		expect(
			validateStatusChange(ticket, 'duplicate', {
				id: 1,
				projectId: 1,
				status: 'open',
				duplicateOfId: null
			})
		).toMatch(/itself/);
		expect(
			validateStatusChange(ticket, 'duplicate', {
				id: 2,
				projectId: 1,
				status: 'duplicate',
				duplicateOfId: 3
			})
		).toMatch(/itself marked/);
		expect(
			validateStatusChange(ticket, 'duplicate', {
				id: 2,
				projectId: 1,
				status: 'open',
				duplicateOfId: 1
			})
		).toMatch(/itself marked/);
		expect(
			validateStatusChange(ticket, 'duplicate', {
				id: 2,
				projectId: 1,
				status: 'planned',
				duplicateOfId: null
			})
		).toBeNull();
	});
});

describe('statusEffect', () => {
	it('classifies transitions', () => {
		expect(statusEffect('in_progress', 'completed')).toBe('completed');
		expect(statusEffect('completed', 'open')).toBe('reopened');
		expect(statusEffect('declined', 'planned')).toBe('reopened');
		expect(statusEffect('open', 'declined')).toBe('closed');
		expect(statusEffect('open', 'planned')).toBe('changed');
	});
});

describe('parseTicketReference', () => {
	it('parses keys, hashes and plain numbers', () => {
		expect(parseTicketReference('SPL-12', 'SPL')).toBe(12);
		expect(parseTicketReference('spl-7', 'SPL')).toBe(7);
		expect(parseTicketReference('#3', 'SPL')).toBe(3);
		expect(parseTicketReference(' 42 ', 'SPL')).toBe(42);
	});
	it('rejects other projects and garbage', () => {
		expect(parseTicketReference('KAN-1', 'SPL')).toBeNull();
		expect(parseTicketReference('SPL-', 'SPL')).toBeNull();
		expect(parseTicketReference('drop table', 'SPL')).toBeNull();
	});
});
