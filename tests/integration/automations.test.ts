import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { access, freshDb, join, makeProject, makeUser } from '../helpers';
import { getDb, schema } from '../../src/lib/server/db';
import type { Project, User } from '../../src/lib/server/db/schema';
import { findProjectById } from '../../src/lib/server/authz';
import '../../src/lib/server/outbound';
import { drainQueue } from '../../src/lib/server/outbound';
import { MAX_DEPTH, processEvent, testRule } from '../../src/lib/server/automations/engine';
import {
	createFromTemplate,
	createRule,
	deleteRule,
	getRule,
	listRuns,
	setRuleEnabled,
	updateRule
} from '../../src/lib/server/automations/rules';
import { addComment } from '../../src/lib/server/services/comments';
import {
	changePriority,
	changeStatus,
	createTicket,
	getTicket,
	getTicketDetail,
	setTicketLabels,
	setVote
} from '../../src/lib/server/services/tickets';
import { createLabel } from '../../src/lib/server/services/projects';
import type { AutomationJob } from '../../src/lib/server/automations/triggers';
import { connectRepository, handleGithubWebhook } from '../../src/lib/server/integrations/github';
import { createHook } from '../../src/lib/server/integrations/hooks';
import { MAX_CHAIN_EVENTS } from '../../src/lib/server/automations/triggers';
import { MAX_RULES } from '../../src/lib/server/automations/rules';

let owner: User, mod: User, member: User, project: Project, other: Project;
const fresh = () => findProjectById(project.id)!;
const input = (title: string, type: 'bug' | 'feature' = 'bug') => ({
	type,
	title,
	descriptionHtml: `<p>${title}</p>`,
	descriptionText: `${title} description`,
	context: {}
});
const ticket = (n: number) => getTicket(project.id, n)!;
const runs = () => getDb().select().from(schema.automationRuns).all();
const rule = (over: Record<string, unknown>) =>
	createRule(
		owner.id,
		access(owner, fresh()),
		{ name: 'Rule', enabled: true, trigger: 'ticket.created', conditions: { any: [] }, ...over },
		null
	);

beforeEach(async () => {
	freshDb();
	process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
	owner = await makeUser();
	mod = await makeUser();
	member = await makeUser();
	project = makeProject(owner, { key: 'SPL' });
	other = makeProject(owner, { key: 'OTH' });
	join(owner, project, mod, 'moderator');
	join(owner, project, member);
});

describe('automation rules', () => {
	it('runs matching rules on ticket creation with multiple actions', async () => {
		const security = createLabel(project.id, 'Security', 'rose');
		const review = createLabel(project.id, 'Needs Review', 'amber');
		rule({
			name: 'Critical security bugs',
			conditions: {
				any: [
					{
						all: [
							{ field: 'type', op: 'is', value: 'bug' },
							{ field: 'title', op: 'contains', value: 'exploit' }
						]
					}
				]
			},
			actions: [
				{ type: 'set_priority', value: 'critical' },
				{ type: 'assign', value: 'owner' },
				{ type: 'add_label', value: review.id }
			]
		});
		expect(security.id).toBeTruthy();
		createTicket(member, access(member, fresh()), input('Login exploit found'));
		createTicket(member, access(member, fresh()), input('Typo on homepage'));
		createTicket(member, access(member, fresh()), input('Exploit idea', 'feature'));
		await drainQueue();
		const t1 = ticket(1);
		expect(t1.priority).toBe('critical');
		expect(t1.assigneeId).toBe(owner.id);
		expect(ticket(2).priority).toBe('medium');
		expect(ticket(3).priority).toBe('medium'); // AND: feature is not a bug
		const [run] = listRuns(project.id).runs;
		expect(run).toMatchObject({
			status: 'success',
			automationName: 'Critical security bugs',
			ticketNumber: 1
		});
		expect(run.actions.map((a) => a.summary)).toEqual([
			'Priority: Medium → Critical',
			expect.stringMatching(/^Assigned → User /),
			'Label added → Needs Review'
		]);
		// History: changes are attributed to the automation, not a person.
		const activity = getDb()
			.select()
			.from(schema.ticketActivity)
			.where(eq(schema.ticketActivity.ticketId, t1.id))
			.all()
			.filter((a) => a.type === 'priority');
		expect(activity[0]).toMatchObject({
			actorId: null,
			data: { automation: { name: 'Critical security bugs' } }
		});
	});

	it('supports OR groups and ignores disabled rules', async () => {
		const r = rule({
			conditions: {
				any: [
					{ all: [{ field: 'title', op: 'contains', value: 'crash' }] },
					{ all: [{ field: 'title', op: 'contains', value: 'freeze' }] }
				]
			},
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		createTicket(member, access(member, fresh()), input('App crash'));
		createTicket(member, access(member, fresh()), input('UI freeze'));
		createTicket(member, access(member, fresh()), input('Slow'));
		await drainQueue();
		expect([1, 2, 3].map((n) => ticket(n).priority)).toEqual(['high', 'high', 'medium']);
		setRuleEnabled(owner.id, access(owner, fresh()), r.id, false, null);
		createTicket(member, access(member, fresh()), input('Another crash'));
		await drainQueue();
		expect(ticket(4).priority).toBe('medium');
		// Nothing is queued for projects without enabled rules.
		expect(
			getDb()
				.select()
				.from(schema.outboundJobs)
				.all()
				.filter((j) => j.kind === 'automation')
		).toHaveLength(3);
	});

	it('prevents loops: a rule runs once per chain and chains stop at the depth limit', async () => {
		const a = rule({
			name: 'A: priority → planned',
			trigger: 'ticket.priority_changed',
			actions: [{ type: 'set_status', value: 'planned' }]
		});
		const b = rule({
			name: 'B: status → priority',
			trigger: 'ticket.status_changed',
			actions: [{ type: 'set_priority', value: 'low' }]
		});
		createTicket(member, access(member, fresh()), input('Loop'));
		await drainQueue();
		changePriority(owner, access(owner, fresh()), ticket(1), 'high');
		await drainQueue();
		// high → (A) planned → (B) low → A would run again: skipped.
		const t = ticket(1);
		expect(t.status).toBe('planned');
		expect(t.priority).toBe('low');
		const all = runs();
		expect(all.filter((r) => r.automationId === a.id && r.status === 'success')).toHaveLength(1);
		expect(all.filter((r) => r.automationId === b.id && r.status === 'success')).toHaveLength(1);
		const skipped = all.find((r) => r.status === 'skipped')!;
		expect(skipped.automationId).toBe(a.id);
		expect(skipped.error).toMatch(/already ran earlier in the same chain/);

		// Depth limit, independent of rule ids.
		const job: AutomationJob = {
			trigger: 'ticket.status_changed',
			projectId: project.id,
			ticketId: t.id,
			eventId: 'aev_depth',
			data: {},
			chain: { depth: MAX_DEPTH, rules: [], root: 'x' },
			summary: ''
		};
		expect(processEvent(job)).toEqual([{ ruleId: b.id, status: 'skipped' }]);
		expect(runs().find((r) => r.eventId === 'aev_depth')!.error).toMatch(/more than 5/);
	});

	it('is idempotent per event (a retried job never repeats actions)', async () => {
		const r = rule({ actions: [{ type: 'public_comment', text: 'Thanks for the report!' }] });
		createTicket(member, access(member, fresh()), input('Once'));
		const job = getDb()
			.select()
			.from(schema.outboundJobs)
			.all()
			.find((j) => j.kind === 'automation')!;
		processEvent(job.payload as unknown as AutomationJob);
		expect(processEvent(job.payload as unknown as AutomationJob)).toEqual([
			{ ruleId: r.id, status: 'duplicate' }
		]);
		expect(ticket(1).commentCount).toBe(1);
	});

	it('isolates failures: the change stays, other rules still run, the failed rule is rolled back', async () => {
		const label = createLabel(project.id, 'Gone', 'slate');
		const broken = rule({
			name: 'Broken',
			actions: [
				{ type: 'set_priority', value: 'critical' },
				{ type: 'add_label', value: label.id }
			]
		});
		rule({ name: 'Fine', actions: [{ type: 'internal_note', text: 'Triage me' }] });
		getDb().delete(schema.ticketLabels).where(eq(schema.ticketLabels.id, label.id)).run();
		createTicket(member, access(member, fresh()), input('Still created'));
		await drainQueue();
		const t = ticket(1);
		expect(t.title).toBe('Still created');
		expect(t.priority).toBe('medium'); // rolled back with the failing label action
		const failed = runs().find((r) => r.automationId === broken.id)!;
		expect(failed.status).toBe('failed');
		expect(failed.error).toMatch(/label no longer exists/);
		expect(failed.actions[0].summary).toMatch(/rolled back/);
		expect(getRule(project.id, broken.id)!.lastError).toMatch(/label/);
		expect(runs().find((r) => r.automationName === 'Fine')!.status).toBe('success');
	});

	it('keeps automated internal notes staff-only and marks automated comments', async () => {
		rule({
			actions: [
				{ type: 'internal_note', text: 'Secret triage note' },
				{ type: 'public_comment', text: 'We received your report.' }
			]
		});
		createTicket(member, access(member, fresh()), input('Private'));
		await drainQueue();
		const t = ticket(1);
		const asMember = getTicketDetail(member, t, { internal: false });
		expect(asMember.comments.map((c) => c.bodyHtml).join()).not.toContain('Secret triage note');
		const publicComment = asMember.comments[0];
		expect(publicComment.meta).toMatchObject({ automation: { name: 'Rule' } });
		const asStaff = getTicketDetail(owner, t, { internal: true });
		expect(
			asStaff.comments.some((c) => c.internal && c.bodyHtml.includes('Secret triage note'))
		).toBe(true);
	});

	it('refuses cross-project references when saving rules', () => {
		const foreign = createLabel(other.id, 'Foreign', 'slate');
		expect(() => rule({ actions: [{ type: 'add_label', value: foreign.id }] })).toThrow(
			/does not belong/
		);
		expect(() =>
			rule({
				conditions: { any: [{ all: [{ field: 'project', op: 'is', value: other.id }] }] },
				actions: [{ type: 'clear_assignee' }]
			})
		).toThrow(/own project/);
		expect(() => rule({ actions: [{ type: 'assign', value: member.id }] })).toThrow(/staff/);
		expect(() =>
			createRule(
				member.id,
				access(member, fresh()),
				{
					name: 'x',
					enabled: true,
					trigger: 'ticket.created',
					actions: [{ type: 'clear_assignee' }]
				},
				null
			)
		).toThrow(/owners and moderators/);
		// Moderators may manage rules.
		expect(
			createRule(
				mod.id,
				access(mod, fresh()),
				{
					name: 'm',
					enabled: false,
					trigger: 'ticket.created',
					actions: [{ type: 'clear_assignee' }]
				},
				null
			).id
		).toBeTruthy();
	});

	it('tests a rule without changing anything', () => {
		createTicket(member, access(member, fresh()), input('Dry run'));
		const t = ticket(1);
		const before = JSON.stringify(t);
		const result = testRule(
			fresh(),
			{
				id: 0,
				name: 'Preview',
				createdById: owner.id,
				trigger: 'ticket.created',
				triggerConfig: {},
				conditions: {
					any: [
						{
							all: [
								{ field: 'type', op: 'is', value: 'bug' },
								{ field: 'priority', op: 'is', value: 'high' }
							]
						}
					]
				},
				actions: [
					{ type: 'set_priority', value: 'critical' },
					{ type: 'set_status', value: 'planned' },
					{ type: 'public_comment', text: 'hello' }
				]
			},
			t
		);
		expect(result.wouldRun).toBe(false);
		expect(result.conditions.groups[0].conditions.map((c) => c.passed)).toEqual([true, false]);
		expect(result.actions.map((a) => a.summary)).toEqual([
			'Priority: Medium → Critical',
			'Status: Open → Planned',
			'Public comment added'
		]);
		expect(JSON.stringify(ticket(1))).toBe(before);
		expect(getDb().select().from(schema.ticketComments).all()).toEqual([]);
		expect(runs()).toEqual([]);
	});

	it('fires on vote thresholds, label changes and templates', async () => {
		const tpl = createFromTemplate(owner.id, access(owner, fresh()), 'popular-feature', null);
		expect(tpl.enabled).toBe(false); // never enabled automatically
		updateRule(
			owner.id,
			access(owner, fresh()),
			tpl.id,
			{ ...tpl, enabled: true, triggerConfig: { threshold: 2 } },
			null
		);
		createTicket(member, access(member, fresh()), input('Dark mode', 'feature'));
		const voter = await makeUser();
		join(owner, project, voter);
		setVote(member, access(member, fresh()), ticket(1), true);
		await drainQueue();
		expect(runs()).toHaveLength(0);
		setVote(voter, access(voter, fresh()), ticket(1), true);
		await drainQueue();
		expect(runs()[0]).toMatchObject({ status: 'success', trigger: 'ticket.vote_threshold' });
		const popular = getDb()
			.select()
			.from(schema.ticketLabels)
			.all()
			.find((l) => l.name === 'Popular')!;
		const labelled = rule({
			trigger: 'ticket.label_added',
			conditions: { any: [{ all: [{ field: 'label', op: 'has', value: popular.id }] }] },
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		setTicketLabels(owner, access(owner, fresh()), ticket(1), []);
		setTicketLabels(owner, access(owner, fresh()), ticket(1), [popular.id]);
		await drainQueue();
		expect(ticket(1).priority).toBe('high');
		expect(runs().some((r) => r.automationId === labelled.id)).toBe(true);
		deleteRule(owner.id, access(owner, fresh()), labelled.id, null);
		expect(runs().find((r) => r.automationName === 'Rule')!.automationId).toBeNull(); // history kept
	});

	it('never runs for comments that are internal notes', async () => {
		rule({ trigger: 'comment.created', actions: [{ type: 'set_priority', value: 'high' }] });
		createTicket(member, access(member, fresh()), input('Notes'));
		addComment(owner, access(owner, fresh()), ticket(1), { html: '<p>x</p>', text: 'x' }, [], {
			internal: true
		});
		await drainQueue();
		expect(ticket(1).priority).toBe('medium');
		addComment(member, access(member, fresh()), ticket(1), { html: '<p>y</p>', text: 'y' });
		await drainQueue();
		expect(ticket(1).priority).toBe('high');
	});

	it('runs GitHub merge rules (and respects the workflow)', async () => {
		const { secret, connection } = connectRepository(
			owner.id,
			access(owner, fresh()),
			{ repository: 'a/spool', mergeAction: 'none' },
			null
		);
		createFromTemplate(owner.id, access(owner, fresh()), 'github-merge', null);
		const r = getDb().select().from(schema.automations).all()[0];
		setRuleEnabled(owner.id, access(owner, fresh()), r.id, true, null);
		createTicket(member, access(member, fresh()), input('Merge me'));
		changeStatus(owner, access(owner, fresh()), ticket(1), { status: 'in_progress', note: null });
		const send = (payload: object, delivery: string) => {
			const body = Buffer.from(JSON.stringify(payload));
			return handleGithubWebhook(
				connection.publicId,
				{
					event: 'pull_request',
					delivery,
					signature: `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
				},
				body
			);
		};
		const pr = (action: string, merged: boolean) => ({
			action,
			repository: { id: 1, full_name: 'a/spool' },
			pull_request: {
				number: 7,
				title: 'Fix SPL-1',
				body: '',
				state: merged ? 'closed' : 'open',
				merged,
				user: { login: 'x' }
			}
		});
		await send(pr('opened', false), 'delivery-0001');
		await send(pr('closed', true), 'delivery-0002');
		await send(pr('closed', true), 'delivery-0002'); // duplicate delivery ignored
		await drainQueue();
		expect(ticket(1).status).toBe('completed');
		expect(runs().filter((x) => x.trigger === 'github.pull_request.merged')).toHaveLength(1);
		expect(ticket(1).commentCount).toBe(1);
	});

	it('bounds fan-out: many rules reacting to each other stop at the chain event limit', async () => {
		for (let i = 0; i < 10; i++)
			rule({
				name: `Flip ${i}`,
				trigger: 'ticket.priority_changed',
				actions: [{ type: 'set_priority', value: i % 2 ? 'high' : 'low' }]
			});
		createTicket(member, access(member, fresh()), input('Fan-out'));
		changePriority(owner, access(owner, fresh()), ticket(1), 'critical');
		await drainQueue();
		const jobs = getDb()
			.select()
			.from(schema.outboundJobs)
			.where(eq(schema.outboundJobs.kind, 'automation'))
			.all();
		// Without the guard this would be tens of thousands of jobs (10·9·8·7·6 at depth 5).
		expect(jobs.length).toBeLessThanOrEqual(MAX_CHAIN_EVENTS);
	});

	it('limits who rules can reach: members only, hooks for owners, a rule cap', async () => {
		const outsider = await makeUser();
		expect(() =>
			rule({ name: 'Spam', actions: [{ type: 'notify', value: String(outsider.id), text: 'Hi' }] })
		).toThrow(/member of this project/);
		expect(() =>
			rule({ name: 'Follow', actions: [{ type: 'follow', value: String(mod.id) }] })
		).not.toThrow();
		const { hook } = createHook(
			owner.id,
			access(owner, fresh()),
			'webhook',
			{
				name: 'Hook',
				url: 'https://hooks.example.com/tikket',
				events: ['ticket.created'],
				enabled: true
			},
			null
		);
		const hookRule = {
			name: 'To hook',
			enabled: true,
			trigger: 'ticket.created',
			conditions: { any: [] },
			actions: [{ type: 'trigger_hook', value: hook.id }]
		};
		expect(() => createRule(mod.id, access(mod, fresh()), hookRule, null)).toThrow(
			/Only project owners/
		);
		expect(createRule(owner.id, access(owner, fresh()), hookRule, null).id).toBeTruthy();
		while (getDb().select().from(schema.automations).all().length < MAX_RULES)
			rule({ name: 'Filler', actions: [{ type: 'set_priority', value: 'low' }] });
		expect(() =>
			rule({ name: 'One too many', actions: [{ type: 'set_priority', value: 'low' }] })
		).toThrow(/at most/);
	});
});
