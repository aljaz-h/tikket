import { beforeEach, describe, expect, it } from 'vitest';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import {
	canReporterReopen,
	changeStatus,
	createTicket,
	getTicket
} from '../../src/lib/server/services/tickets';
import { addComment } from '../../src/lib/server/services/comments';
import { bulkUpdate } from '../../src/lib/server/services/bulk';
import { saveWorkflow } from '../../src/lib/server/services/workflow';
import {
	allowedTargets,
	checkTransition,
	validateWorkflow
} from '../../src/lib/shared/workflow-settings';
import { DEFAULT_WORKFLOW, type WorkflowSettings } from '../../src/lib/shared/constants';

let owner: User, mod: User, reporter: User, project: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string) => ({
	type: 'bug' as const,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: title,
	context: {}
});
const save = (w: Partial<WorkflowSettings>) =>
	saveWorkflow(owner.id, access(owner, fresh()), { ...DEFAULT_WORKFLOW, ...w }, null);
const rich = (text: string) => ({ html: `<p>${text}</p>`, text });

beforeEach(async () => {
	freshDb();
	owner = await makeUser();
	mod = await makeUser();
	reporter = await makeUser();
	project = makeProject(owner, { key: 'WFL' });
	join(owner, project, mod, 'moderator');
	join(owner, project, reporter);
});

describe('workflow rules (pure)', () => {
	it('validates configurations', () => {
		expect(validateWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
		expect(validateWorkflow({ ...DEFAULT_WORKFLOW, enabled: ['completed', 'declined'] })).toEqual(
			expect.arrayContaining([expect.stringMatching(/open status/)])
		);
		expect(validateWorkflow({ ...DEFAULT_WORKFLOW, defaultStatus: 'completed' })[0]).toMatch(
			/open status/
		);
		expect(
			validateWorkflow({
				...DEFAULT_WORKFLOW,
				enabled: ['open', 'completed'],
				defaultStatus: 'planned'
			})
		).toContain('The default status must be enabled.');
		expect(
			validateWorkflow({
				...DEFAULT_WORKFLOW,
				transitions: { open: ['planned'], planned: ['open'] }
			})[0]
		).toMatch(/can ever be resolved/);
		expect(
			validateWorkflow({ ...DEFAULT_WORKFLOW, transitions: { open: ['open', 'completed'] } })
		).toContain('Open cannot transition to itself.');
	});

	it('computes allowed targets and checks transitions', () => {
		const w: WorkflowSettings = {
			...DEFAULT_WORKFLOW,
			enabled: ['open', 'in_progress', 'completed'],
			transitions: { open: ['in_progress'], in_progress: ['completed', 'open'] },
			requireNote: ['completed']
		};
		expect(allowedTargets(w, 'open')).toEqual(['in_progress']);
		expect(checkTransition(w, 'open', 'completed', null)).toMatch(/cannot move/);
		expect(checkTransition(w, 'open', 'planned', null)).toMatch(/disabled/);
		expect(checkTransition(w, 'in_progress', 'completed', null)).toMatch(/note is required/);
		expect(checkTransition(w, 'in_progress', 'completed', 'Shipped')).toBeNull();
	});
});

describe('workflow enforcement', () => {
	it('only owners save, and invalid settings are rejected', () => {
		expect(() => saveWorkflow(mod.id, access(mod, fresh()), DEFAULT_WORKFLOW, null)).toThrow(
			/owners/
		);
		expect(() => save({ enabled: ['completed'] })).toThrow();
		expect(save({ defaultPriority: 'high' }).defaultPriority).toBe('high');
	});

	it('applies defaults to new tickets', () => {
		save({ defaultStatus: 'planned', defaultPriority: 'low' });
		const t = createTicket(reporter, access(reporter, fresh()), input('Defaults'));
		expect(t.status).toBe('planned');
		expect(t.priority).toBe('low');
	});

	it('blocks disallowed transitions and requires notes', () => {
		save({
			transitions: {
				open: ['in_progress'],
				in_progress: ['completed'],
				completed: ['open']
			},
			requireNote: ['completed']
		});
		const t = createTicket(reporter, access(reporter, fresh()), input('Flow'));
		expect(() =>
			changeStatus(mod, access(mod, fresh()), t, { status: 'completed', note: null })
		).toThrow(/cannot move/);
		changeStatus(mod, access(mod, fresh()), t, { status: 'in_progress', note: null });
		expect(() =>
			changeStatus(mod, access(mod, fresh()), getTicket(project.id, 1)!, {
				status: 'completed',
				note: null
			})
		).toThrow(/note is required/);
		changeStatus(mod, access(mod, fresh()), getTicket(project.id, 1)!, {
			status: 'completed',
			note: 'Fixed in 1.2'
		});
		expect(getTicket(project.id, 1)!.status).toBe('completed');
	});

	it('bulk changes skip tickets whose transition is not allowed', () => {
		save({ transitions: { open: ['planned'], planned: ['completed'], completed: ['open'] } });
		createTicket(reporter, access(reporter, fresh()), input('A'));
		const b = createTicket(reporter, access(reporter, fresh()), input('B'));
		changeStatus(mod, access(mod, fresh()), b, { status: 'planned', note: null });
		const result = bulkUpdate(mod, access(mod, fresh()), [1, 2], {
			kind: 'status',
			status: 'completed'
		});
		expect(getTicket(project.id, 1)!.status).toBe('open');
		expect(getTicket(project.id, 2)!.status).toBe('completed');
		expect(result.skipped.map((s) => s.number)).toEqual([1]);
	});

	it('lets reporters reopen their completed tickets only when enabled', () => {
		const t = createTicket(reporter, access(reporter, fresh()), input('Reopen'));
		changeStatus(mod, access(mod, fresh()), t, { status: 'completed', note: null });
		const done = getTicket(project.id, 1)!;
		expect(canReporterReopen(reporter, access(reporter, fresh()), done)).toBe(false);
		expect(() =>
			changeStatus(reporter, access(reporter, fresh()), done, { status: 'open', note: null })
		).toThrow(/staff/);
		save({ reporterCanReopen: true });
		expect(canReporterReopen(reporter, access(reporter, fresh()), done)).toBe(true);
		expect(canReporterReopen(mod, access(mod, fresh()), done)).toBe(false);
		// Reporters may only reopen – not pick any other status.
		expect(() =>
			changeStatus(reporter, access(reporter, fresh()), done, { status: 'declined', note: null })
		).toThrow(/staff/);
		changeStatus(reporter, access(reporter, fresh()), done, { status: 'open', note: null });
		expect(getTicket(project.id, 1)!.status).toBe('open');
	});

	it('closes completed tickets for public comments when configured', () => {
		const t = createTicket(reporter, access(reporter, fresh()), input('Closed'));
		changeStatus(mod, access(mod, fresh()), t, { status: 'completed', note: null });
		save({ commentsOnCompleted: false });
		const done = getTicket(project.id, 1)!;
		expect(() => addComment(reporter, access(reporter, fresh()), done, rich('More'))).toThrow(
			/closed/
		);
		expect(addComment(mod, access(mod, fresh()), done, rich('Staff reply')).id).toBeTruthy();
	});
});
