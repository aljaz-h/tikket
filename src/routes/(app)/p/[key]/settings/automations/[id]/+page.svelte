<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CircleMinus from '@lucide/svelte/icons/circle-minus';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import Textarea from '$lib/components/ui/textarea.svelte';
	import {
		ACTION_META,
		ACTION_TYPES,
		AUTOMATION_TRIGGER_META,
		AUTOMATION_TRIGGERS,
		CONDITION_FIELDS,
		PRIORITY_META,
		STATUS_META,
		TICKET_PRIORITIES,
		TICKET_STATUSES,
		TICKET_TYPES,
		TYPE_META,
		type ActionType,
		type AutomationAction,
		type AutomationCondition,
		type AutomationTrigger,
		type ConditionField,
		type ConditionOp
	} from '$lib/shared/constants';
	import {
		FIELD_LABEL,
		FIELD_OPS,
		OP_LABEL,
		PEOPLE_TARGET_LABEL,
		PEOPLE_TARGETS,
		REPORTER_ROLE_LABEL,
		REPORTER_ROLES
	} from '$lib/shared/automation';
	import { projectPath } from '$lib/shared/format';

	let { data, form } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/automations'));
	const o = $derived(data.options);

	let name = $state('');
	let description = $state('');
	let enabled = $state(false);
	let trigger = $state<AutomationTrigger>('ticket.created');
	let threshold = $state('10');
	let groups = $state<{ all: AutomationCondition[] }[]>([]);
	let actions = $state<AutomationAction[]>([]);
	let saving = $state(false);
	let testTicket = $state('');
	let testing = $state(false);
	$effect.pre(() => {
		const r = data.rule;
		name = r?.name ?? '';
		description = r?.description ?? '';
		enabled = r?.enabled ?? false;
		trigger = r?.trigger ?? 'ticket.created';
		threshold = String(r?.triggerConfig?.threshold ?? 10);
		groups = structuredClone(r?.conditions.any ?? []);
		actions = structuredClone(r?.actions ?? [{ type: 'set_priority', value: 'high' }]);
		testTicket = o.recentTickets[0] ? String(o.recentTickets[0].number) : '';
	});
	$effect(() => {
		if (page.url.searchParams.has('saved')) toast.success('Automation saved');
	});

	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const test = $derived(form && 'test' in form ? form.test : null);
	const ruleJson = $derived(
		JSON.stringify({
			name,
			description: description || null,
			enabled,
			trigger,
			triggerConfig: trigger === 'ticket.vote_threshold' ? { threshold: Number(threshold) } : {},
			conditions: { any: groups },
			actions
		})
	);

	type Option = { value: string; label: string };
	const enumItems = <T extends string>(list: readonly T[], label: (v: T) => string): Option[] =>
		list.map((v) => ({ value: v, label: label(v) }));
	const people = (list: { id: number; name: string }[]): Option[] =>
		list.map((p) => ({ value: String(p.id), label: p.name }));
	const refs = (list: { id: number; name: string }[]): Option[] =>
		list.map((x) => ({ value: String(x.id), label: x.name }));

	/** Value choices for a condition field (null = free input). */
	function valueItems(field: ConditionField): Option[] | 'text' | 'number' | null {
		switch (field) {
			case 'type':
				return enumItems(TICKET_TYPES, (t) => TYPE_META[t].label);
			case 'status':
				return enumItems(TICKET_STATUSES, (s) => STATUS_META[s].label);
			case 'priority':
				return enumItems(TICKET_PRIORITIES, (p) => PRIORITY_META[p].label);
			case 'reporter_role':
				return enumItems(REPORTER_ROLES, (r) => REPORTER_ROLE_LABEL[r]);
			case 'assignee':
				return people(o.staff);
			case 'reporter':
				return people(o.members);
			case 'label':
				return refs(o.labels);
			case 'milestone':
				return refs(o.milestones);
			case 'release':
				return refs(o.releases);
			case 'project':
				return [{ value: String(data.projectId), label: data.project.name }];
			case 'votes':
			case 'age_days':
				return 'number';
			case 'title':
			case 'description':
				return 'text';
			default:
				return null;
		}
	}
	const needsValue = (op: ConditionOp) =>
		!['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(op);

	function setField(c: AutomationCondition, field: ConditionField) {
		c.field = field;
		c.op = FIELD_OPS[field][0];
		const items = valueItems(field);
		c.value = Array.isArray(items) ? (items[0]?.value ?? '') : '';
	}
	function newCondition(): AutomationCondition {
		return { field: 'type', op: 'is', value: 'bug' };
	}

	const peopleTargets = $derived([
		...PEOPLE_TARGETS.map((t) => ({ value: t, label: PEOPLE_TARGET_LABEL[t] })),
		...o.members.map((m) => ({ value: String(m.id), label: m.name }))
	]);
	function actionItems(type: ActionType): Option[] | null {
		switch (type) {
			case 'set_status':
				return enumItems(
					TICKET_STATUSES.filter((s) => s !== 'duplicate'),
					(s) => STATUS_META[s].label
				);
			case 'set_priority':
				return enumItems(TICKET_PRIORITIES, (p) => PRIORITY_META[p].label);
			case 'assign':
				return [{ value: 'owner', label: 'Project owner' }, ...people(o.staff)];
			case 'add_label':
			case 'remove_label':
				return refs(o.labels);
			case 'set_milestone':
				return refs(o.milestones);
			case 'set_release':
				return refs(o.releases);
			case 'follow':
			case 'notify':
				return peopleTargets;
			case 'trigger_hook':
				return o.hooks.map((h) => ({
					value: String(h.id),
					label: `${h.kind === 'discord' ? 'Discord' : 'Webhook'}: ${h.name}`
				}));
			default:
				return null;
		}
	}
	const textAction = (t: ActionType) =>
		['internal_note', 'public_comment', 'notify', 'set_status', 'trigger_hook'].includes(t);
	const textRequired = (t: ActionType) => t === 'internal_note' || t === 'public_comment';
	function setActionType(a: AutomationAction, type: ActionType) {
		a.type = type;
		const items = actionItems(type);
		a.value = items?.[0]?.value ?? null;
		a.text = textAction(type) ? (a.text ?? '') : null;
	}
	const actionChoices = ACTION_TYPES.map((t) => ({ value: t, label: ACTION_META[t].label }));
	const statusIcon = (passed: boolean) => (passed ? CircleCheck : CircleX);
	const describe = (c: AutomationCondition) => {
		const items = valueItems(c.field);
		const value = Array.isArray(items)
			? (items.find((i) => i.value === String(c.value))?.label ?? String(c.value ?? ''))
			: String(c.value ?? '');
		return `${FIELD_LABEL[c.field]} ${OP_LABEL[c.op]}${needsValue(c.op) ? ` ${value}` : ''}`;
	};
</script>

<nav
	aria-label="Breadcrumb"
	class="-mt-2 mb-4 flex items-center gap-1 text-sm text-muted-foreground"
>
	<a href={base} class="inline-flex items-center gap-1 hover:text-foreground"
		><ChevronLeft class="size-4" />Automations</a
	>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-foreground" aria-current="page"
		>{data.rule ? data.rule.name : 'New automation'}</span
	>
</nav>

<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
	<form
		method="POST"
		action="?/save"
		class="grid content-start gap-6"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				saving = false;
				if (result.type === 'failure') {
					toast.error(
						Object.values((result.data?.errors ?? {}) as Record<string, string>)[0] ??
							'Could not save'
					);
					await update({ reset: false });
					return;
				}
				if (result.type === 'success') toast.success('Automation saved');
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="rule" value={ruleJson} />
		<Card class="grid gap-4 p-5 sm:p-6">
			<FormMessage message={errors.form} />
			<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
				<Field label="Name" for="name" required>
					<Input
						id="name"
						bind:value={name}
						maxlength={80}
						placeholder="Auto-prioritise critical bugs"
					/>
				</Field>
				<label class="flex items-center gap-3 pb-2">
					<Switch bind:checked={enabled} />
					<span class="text-sm font-medium">{enabled ? 'Enabled' : 'Disabled'}</span>
				</label>
			</div>
			<Field label="Description" for="description" optional>
				<Input id="description" bind:value={description} maxlength={300} />
			</Field>
		</Card>

		<!-- WHEN -->
		<Card class="grid gap-3 p-5 sm:p-6">
			<h2 class="text-xs font-semibold tracking-widest text-muted-foreground">WHEN</h2>
			<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
				<Select
					aria-label="Trigger"
					bind:value={trigger}
					items={AUTOMATION_TRIGGERS.map((t) => ({
						value: t,
						label: AUTOMATION_TRIGGER_META[t].label
					}))}
				/>
				{#if trigger === 'ticket.vote_threshold'}
					<Input type="number" min="1" bind:value={threshold} aria-label="Number of votes" />
				{/if}
			</div>
			<p class="text-xs text-muted-foreground">{AUTOMATION_TRIGGER_META[trigger].hint}</p>
		</Card>

		<!-- IF -->
		<Card class="grid gap-3 p-5 sm:p-6">
			<h2 class="text-xs font-semibold tracking-widest text-muted-foreground">IF</h2>
			{#if !groups.length}
				<p class="text-sm text-muted-foreground">No conditions: the rule runs for every ticket.</p>
			{/if}
			{#each groups as group, gi (gi)}
				{#if gi > 0}
					<p class="text-xs font-semibold tracking-widest text-link">OR</p>
				{/if}
				<div class="grid gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
					{#each group.all as cond, ci (ci)}
						{#if ci > 0}<p
								class="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground"
							>
								AND
							</p>{/if}
						{@const items = valueItems(cond.field)}
						<div class="grid gap-2 sm:grid-cols-[10rem_9rem_minmax(0,1fr)_auto]">
							<Select
								size="sm"
								aria-label="Field"
								value={cond.field}
								onchange={(v: string) => setField(cond, v as ConditionField)}
								items={CONDITION_FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] }))}
							/>
							<Select
								size="sm"
								aria-label="Operator"
								bind:value={cond.op}
								items={FIELD_OPS[cond.field].map((op) => ({ value: op, label: OP_LABEL[op] }))}
							/>
							{#if needsValue(cond.op)}
								{#if Array.isArray(items)}
									<Select
										size="sm"
										aria-label="Value"
										value={String(cond.value ?? '')}
										onchange={(v: string) => (cond.value = v)}
										{items}
										placeholder={items.length ? 'Choose…' : 'Nothing to choose yet'}
									/>
								{:else if items === 'number'}
									<Input
										class="h-8"
										type="number"
										min="0"
										aria-label="Value"
										bind:value={cond.value}
									/>
								{:else}
									<Input class="h-8" aria-label="Value" bind:value={cond.value} maxlength={200} />
								{/if}
							{:else}
								<span></span>
							{/if}
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Remove condition"
								onclick={() => {
									group.all.splice(ci, 1);
									if (!group.all.length) groups.splice(gi, 1);
								}}><X /></Button
							>
						</div>
					{/each}
					<Button
						variant="ghost"
						size="xs"
						class="justify-self-start"
						onclick={() => group.all.push(newCondition())}
						disabled={group.all.length >= 10}><Plus /> And</Button
					>
				</div>
			{/each}
			<Button
				variant="outline"
				size="sm"
				class="justify-self-start"
				onclick={() => groups.push({ all: [newCondition()] })}
				disabled={groups.length >= 5}><Plus /> {groups.length ? 'Or' : 'Add condition'}</Button
			>
		</Card>

		<!-- THEN -->
		<Card class="grid gap-3 p-5 sm:p-6">
			<h2 class="text-xs font-semibold tracking-widest text-muted-foreground">THEN</h2>
			{#each actions as action, ai (ai)}
				{@const items = actionItems(action.type)}
				<div class="grid gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
					<div class="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
						<Select
							size="sm"
							aria-label="Action"
							value={action.type}
							onchange={(v: string) => setActionType(action, v as ActionType)}
							items={actionChoices}
						/>
						{#if items}
							<Select
								size="sm"
								aria-label="Action value"
								value={String(action.value ?? '')}
								onchange={(v: string) => (action.value = v)}
								{items}
								placeholder={items.length ? 'Choose…' : 'Nothing to choose yet'}
							/>
						{:else}
							<span></span>
						{/if}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Remove action"
							onclick={() => actions.splice(ai, 1)}
							disabled={actions.length <= 1}><X /></Button
						>
					</div>
					{#if textAction(action.type)}
						<Textarea
							rows={2}
							bind:value={action.text}
							maxlength={action.type === 'internal_note' || action.type === 'public_comment'
								? 4000
								: 300}
							aria-label="Text"
							placeholder={action.type === 'set_status'
								? 'Status note (optional unless the workflow requires one)'
								: action.type === 'public_comment'
									? 'Shown to everyone, marked as automated'
									: action.type === 'internal_note'
										? 'Visible to project staff only'
										: 'Optional message'}
							required={textRequired(action.type)}
						/>
					{/if}
				</div>
			{/each}
			<Button
				variant="outline"
				size="sm"
				class="justify-self-start"
				onclick={() =>
					actions.push({ type: 'add_label', value: o.labels[0] ? String(o.labels[0].id) : null })}
				disabled={actions.length >= 10}><Plus /> Add action</Button
			>
		</Card>

		<div class="flex flex-wrap justify-end gap-2">
			<Button variant="ghost" href={base}>Cancel</Button>
			<Button type="submit" loading={saving} disabled={data.archived}>Save automation</Button>
		</div>
	</form>

	<aside class="grid content-start gap-4">
		<Card class="grid gap-3 p-5">
			<h2 class="flex items-center gap-2 text-sm font-semibold">
				<FlaskConical class="size-4 text-muted-foreground" /> Test this rule
			</h2>
			<p class="text-xs text-muted-foreground">
				Preview what the rule (as currently edited) would do on a ticket. Nothing is changed.
			</p>
			<form
				method="POST"
				action="?/test"
				class="grid gap-2"
				use:enhance={() => {
					testing = true;
					return async ({ update }) => {
						testing = false;
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="rule" value={ruleJson} />
				<Select
					aria-label="Ticket"
					name="ticket"
					bind:value={testTicket}
					searchable
					items={o.recentTickets.map((t) => ({
						value: String(t.number),
						label: `${data.project.key}-${t.number} ${t.title}`
					}))}
					placeholder="Choose a ticket"
				/>
				<Button type="submit" variant="outline" size="sm" loading={testing} disabled={!testTicket}
					>Run test</Button
				>
			</form>
			<FormMessage message={errors.test ?? errors.ticket} />
			{#if test}
				<div class="grid gap-3 border-t border-border pt-3 text-sm" aria-live="polite">
					<p class="font-medium [overflow-wrap:anywhere]">
						{data.project.key}-{test.ticket.number} · {test.ticket.title}
					</p>
					<p class={test.wouldRun ? 'text-success' : 'text-muted-foreground'}>
						{test.wouldRun
							? 'Conditions pass – the rule would run.'
							: 'Conditions do not pass – the rule would not run.'}
					</p>
					{#if test.triggerNote}<p class="text-xs text-muted-foreground">{test.triggerNote}</p>{/if}
					{#if test.conditions.groups.length}
						<ul class="grid gap-1 text-xs">
							{#each test.conditions.groups as g, gi (gi)}
								{#if gi > 0}<li class="font-semibold text-link">OR</li>{/if}
								{#each g.conditions as c, ci (ci)}
									{@const Icon = statusIcon(c.passed)}
									<li class="flex items-start gap-1.5">
										<Icon
											class="mt-0.5 size-3.5 shrink-0 {c.passed
												? 'text-success'
												: 'text-destructive'}"
										/>
										{describe(c.condition)}
									</li>
								{/each}
							{/each}
						</ul>
					{/if}
					<div class="grid gap-1">
						<p class="text-xs font-medium text-muted-foreground">
							{test.wouldRun ? 'Actions that would run' : 'Actions (if it ran)'}
						</p>
						<ul class="grid gap-1 text-xs">
							{#each test.actions as a, i (i)}
								<li class="flex items-start gap-1.5">
									{#if !a.ok}<CircleX class="mt-0.5 size-3.5 shrink-0 text-destructive" />
									{:else if a.changed}<CircleCheck class="mt-0.5 size-3.5 shrink-0 text-success" />
									{:else}<CircleMinus class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{/if}
									<span class="[overflow-wrap:anywhere]"
										>{a.summary}{#if a.error}
											– {a.error}{/if}</span
									>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
		</Card>
		{#if data.rule}
			<Card class="grid gap-1 p-5 text-xs text-muted-foreground">
				<p>{data.rule.runCount} run{data.rule.runCount === 1 ? '' : 's'}</p>
				{#if data.rule.lastError}<p class="text-destructive">
						Last error: {data.rule.lastError}
					</p>{/if}
				<a href="{base}/history?automation={data.rule.id}" class="text-link hover:underline"
					>View history</a
				>
			</Card>
		{/if}
	</aside>
</div>
