<script lang="ts">
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import {
		PRIORITY_META,
		STATUS_META,
		TICKET_PRIORITIES,
		TICKET_STATUSES,
		type TicketPriority,
		type TicketStatus
	} from '$lib/shared/constants';
	import { validateWorkflow } from '$lib/shared/workflow-settings';
	import { cn } from '$lib/utils';

	let { data } = $props();

	let enabled = $state<TicketStatus[]>([]);
	let defaultStatus = $state<string>('open');
	let defaultPriority = $state<string>('medium');
	let restrict = $state(false);
	let transitions = $state<Record<TicketStatus, TicketStatus[]>>(
		{} as Record<TicketStatus, TicketStatus[]>
	);
	let reporterCanReopen = $state(false);
	let commentsOnCompleted = $state(true);
	let requireNote = $state<TicketStatus[]>([]);
	$effect.pre(() => {
		const w = data.workflow;
		enabled = [...w.enabled];
		defaultStatus = w.defaultStatus;
		defaultPriority = w.defaultPriority;
		restrict = !!w.transitions;
		transitions = Object.fromEntries(
			TICKET_STATUSES.map((s) => [
				s,
				w.transitions?.[s] ?? TICKET_STATUSES.filter((t) => t !== s && w.enabled.includes(t))
			])
		) as Record<TicketStatus, TicketStatus[]>;
		reporterCanReopen = w.reporterCanReopen;
		commentsOnCompleted = w.commentsOnCompleted;
		requireNote = [...w.requireNote];
	});

	const current = $derived({
		enabled: TICKET_STATUSES.filter((s) => enabled.includes(s)),
		defaultStatus: defaultStatus as TicketStatus,
		defaultPriority: defaultPriority as TicketPriority,
		transitions: restrict
			? (Object.fromEntries(
					TICKET_STATUSES.map((s) => [s, transitions[s].filter((t) => enabled.includes(t))])
				) as Record<TicketStatus, TicketStatus[]>)
			: null,
		reporterCanReopen,
		commentsOnCompleted,
		requireNote
	});
	const problems = $derived(validateWorkflow(current));
	const enabledStatuses = $derived(TICKET_STATUSES.filter((s) => enabled.includes(s)));
</script>

<form
	method="POST"
	action="?/save"
	class="grid gap-6"
	use:enhance={quickSubmit({ success: 'Workflow saved' })}
	aria-describedby={problems.length ? 'workflow-problems' : undefined}
>
	<Card class="grid gap-5 p-5 sm:p-6">
		<div>
			<h2 class="text-base font-semibold">Statuses</h2>
			<p class="text-sm text-muted-foreground">
				Choose which of the built-in statuses this project uses. Disabling a status hides it from
				status menus, automations and the API – tickets already in it keep their status and history.
			</p>
		</div>
		<ul class="grid gap-2 sm:grid-cols-2">
			{#each TICKET_STATUSES as s (s)}
				<li>
					<label
						class="flex items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft"
					>
						<Checkbox name="enabled" value={s} bind:group={enabled} class="mt-0.5" />
						<span class="grid min-w-0 gap-1">
							<StatusBadge status={s} />
							<span class="text-xs text-muted-foreground">
								{STATUS_META[s].description}
								{#if data.counts[s]}· {data.counts[s]} ticket{data.counts[s] === 1 ? '' : 's'}{/if}
							</span>
						</span>
					</label>
				</li>
			{/each}
		</ul>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Status of new tickets" for="defaultStatus">
				<Select
					id="defaultStatus"
					name="defaultStatus"
					bind:value={defaultStatus}
					items={enabledStatuses
						.filter((s) => !STATUS_META[s].resolved)
						.map((s) => ({ value: s, label: STATUS_META[s].label }))}
				/>
			</Field>
			<Field label="Priority of new tickets" for="defaultPriority">
				<Select
					id="defaultPriority"
					name="defaultPriority"
					bind:value={defaultPriority}
					items={TICKET_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
				/>
			</Field>
		</div>
	</Card>

	<Card class="grid gap-5 p-5 sm:p-6">
		<label class="flex items-start gap-3">
			<Switch name="restrict" bind:checked={restrict} class="mt-0.5" />
			<span>
				<span class="block text-base font-semibold">Restrict status transitions</span>
				<span class="block text-sm text-muted-foreground">
					Off: staff can move a ticket to any enabled status. On: only the transitions ticked below
					are offered and accepted (web app, bulk edit, automations and API).
				</span>
			</span>
		</label>
		{#if restrict}
			<div class="overflow-x-auto rounded-lg border border-border">
				<table class="w-full min-w-[36rem] text-left text-xs">
					<caption class="sr-only"
						>Allowed transitions: rows are the current status, columns the new one</caption
					>
					<thead class="bg-surface-2 text-muted-foreground">
						<tr>
							<th scope="col" class="px-3 py-2 font-medium">From ↓ / to →</th>
							{#each enabledStatuses as to (to)}
								<th scope="col" class="px-2 py-2 text-center font-medium"
									>{STATUS_META[to].label}</th
								>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each TICKET_STATUSES as from (from)}
							<tr class={cn('border-t border-border', !enabled.includes(from) && 'opacity-60')}>
								<th scope="row" class="px-3 py-2 font-medium whitespace-nowrap">
									{STATUS_META[from].label}
									{#if !enabled.includes(from)}<span class="font-normal text-muted-foreground">
											(disabled)</span
										>{/if}
								</th>
								{#each enabledStatuses as to (to)}
									<td class="px-2 py-2 text-center">
										{#if from === to}
											<span class="text-muted-foreground" aria-hidden="true">—</span>
										{:else}
											<Checkbox
												name="to_{from}"
												value={to}
												bind:group={transitions[from]}
												aria-label="{STATUS_META[from].label} to {STATUS_META[to].label}"
											/>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	<Card class="grid gap-4 p-5 sm:p-6">
		<h2 class="text-base font-semibold">Rules</h2>
		<label class="flex items-start gap-3">
			<Switch name="reporterCanReopen" bind:checked={reporterCanReopen} class="mt-0.5" />
			<span>
				<span class="block text-sm font-medium">Reporters can reopen completed tickets</span>
				<span class="block text-xs text-muted-foreground">
					The reporter sees a “Reopen ticket” button on their own completed tickets. It moves the
					ticket back to the status of new tickets{restrict
						? ' if that transition is allowed'
						: ''}.
				</span>
			</span>
		</label>
		<label class="flex items-start gap-3">
			<Switch name="commentsOnCompleted" bind:checked={commentsOnCompleted} class="mt-0.5" />
			<span>
				<span class="block text-sm font-medium">Allow comments on completed tickets</span>
				<span class="block text-xs text-muted-foreground">
					Off: completed tickets are closed for new public comments (staff can still comment and
					write internal notes).
				</span>
			</span>
		</label>
		<fieldset class="grid gap-2">
			<legend class="mb-1 text-sm font-medium">Require a note when changing the status to</legend>
			<div class="flex flex-wrap gap-2">
				{#each enabledStatuses as s (s)}
					<label
						class="inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft"
					>
						<Checkbox name="requireNote" value={s} bind:group={requireNote} />
						{STATUS_META[s].label}
					</label>
				{/each}
			</div>
		</fieldset>
	</Card>

	{#if problems.length}
		<div
			id="workflow-problems"
			role="alert"
			class="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
		>
			{#each problems as p (p)}
				<p class="flex items-start gap-2"><CircleAlert class="mt-0.5 size-4 shrink-0" />{p}</p>
			{/each}
		</div>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button type="submit" variant="ghost" formaction="?/reset" formnovalidate
			>Reset to defaults</Button
		>
		<Button type="submit" disabled={problems.length > 0}>Save workflow</Button>
	</div>
</form>
