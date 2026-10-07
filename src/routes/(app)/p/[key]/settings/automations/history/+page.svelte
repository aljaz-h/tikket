<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CircleMinus from '@lucide/svelte/icons/circle-minus';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import {
		AUTOMATION_PROTECTION_LABEL,
		AUTOMATION_TRIGGER_META,
		type AutomationProtection
	} from '$lib/shared/constants';
	import { formatDateTime, projectPath, ticketPath } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/automations'));
	let automation = $state('');
	let status = $state('');
	let ticket = $state('');
	let from = $state('');
	let to = $state('');
	let open = $state<number | null>(null);
	$effect.pre(() => {
		automation = data.filters.automation;
		status = data.filters.status;
		ticket = data.filters.ticket;
		from = data.filters.from;
		to = data.filters.to;
	});
	function apply(extra: Record<string, string> = {}) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built once per navigation
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries({ automation, status, ticket, from, to, ...extra }))
			if (v) q.set(k, v);
		goto(`?${q}`, { keepFocus: true, noScroll: true });
	}
	const runState = (s: string) => (s === 'success' ? 'ok' : s === 'failed' ? 'error' : 'warn');
	const label = (s: string) =>
		s === 'success' ? 'Success' : s === 'failed' ? 'Failed' : 'Skipped';
</script>

<nav
	aria-label="Breadcrumb"
	class="-mt-2 mb-4 flex items-center gap-1 text-sm text-muted-foreground"
>
	<a href={base} class="inline-flex items-center gap-1 hover:text-foreground"
		><ChevronLeft class="size-4" />Automations</a
	>
	<span aria-hidden="true">/</span>
	<span class="font-medium text-foreground" aria-current="page">History</span>
</nav>

<div class="grid gap-4">
	<Card class="p-4">
		<form
			class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]"
			onsubmit={(e) => {
				e.preventDefault();
				apply();
			}}
		>
			<Select
				aria-label="Automation"
				size="sm"
				bind:value={automation}
				items={[
					{ value: '', label: 'All automations' },
					...data.rules.map((r) => ({ value: String(r.id), label: r.name }))
				]}
			/>
			<Select
				aria-label="Result"
				size="sm"
				bind:value={status}
				items={[
					{ value: '', label: 'All results' },
					{ value: 'success', label: 'Success' },
					{ value: 'failed', label: 'Failed' },
					{ value: 'skipped', label: 'Skipped' },
					{ value: 'protected', label: 'Stopped by a safety limit' }
				]}
			/>
			<Input
				class="h-8"
				aria-label="Ticket"
				placeholder="{data.project.key}-12"
				bind:value={ticket}
			/>
			<Input class="h-8" type="date" aria-label="From" bind:value={from} />
			<Input class="h-8" type="date" aria-label="To" bind:value={to} />
			<Button type="submit" size="sm">Filter</Button>
		</form>
	</Card>

	{#if data.runs.length}
		<ul class="grid gap-2" aria-label="Automation runs">
			{#each data.runs as run (run.id)}
				<li>
					<Card class="p-0">
						<button
							type="button"
							class="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left"
							aria-expanded={open === run.id}
							onclick={() => (open = open === run.id ? null : run.id)}
						>
							<IntegrationStatus state={runState(run.status)} label={label(run.status)} />
							<span class="min-w-0 flex-1 text-sm">
								{#if run.protection}<ShieldAlert
										class="mr-1 inline size-3.5 align-[-2px] text-warning"
										aria-label={AUTOMATION_PROTECTION_LABEL[run.protection as AutomationProtection]}
									/>{/if}
								<span class="font-medium [overflow-wrap:anywhere]">{run.automationName}</span>
								<span class="text-muted-foreground">
									· {AUTOMATION_TRIGGER_META[run.trigger]?.label ?? run.trigger}
									{#if run.ticketNumber}· {data.project.key}-{run.ticketNumber}{/if}
								</span>
							</span>
							<span class="text-xs text-muted-foreground tabular-nums"
								>{run.durationMs} ms · <TimeAgo date={run.createdAt} /></span
							>
							<ChevronDown
								class={cn(
									'size-4 text-muted-foreground transition-transform',
									open === run.id && 'rotate-180'
								)}
							/>
						</button>
						{#if open === run.id}
							<div class="grid gap-3 border-t border-border px-4 py-3 text-sm">
								<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
									<dt class="text-muted-foreground">Automation</dt>
									<dd>
										{#if run.automationId}<a
												href="{base}/{run.automationId}"
												class="text-link hover:underline">{run.automationName}</a
											>{:else if run.protection === 'fanout'}Several rules{:else}{run.automationName}
											(deleted){/if}
									</dd>
									<dt class="text-muted-foreground">Duration</dt>
									<dd>{run.durationMs} ms</dd>
									<dt class="text-muted-foreground">Ticket</dt>
									<dd>
										{#if run.ticketNumber}<a
												href={ticketPath(data.project.key, run.ticketNumber)}
												class="[overflow-wrap:anywhere] text-link hover:underline"
												>{data.project.key}-{run.ticketNumber} {run.ticketTitle}</a
											>{:else}—{/if}
									</dd>
									<dt class="text-muted-foreground">Time</dt>
									<dd>{formatDateTime(run.createdAt)}</dd>
									<dt class="text-muted-foreground">Chain depth</dt>
									<dd>
										{run.depth === 0
											? 'Direct (caused by a person or integration)'
											: `${run.depth} (caused by another automation)`}
									</dd>
									{#if run.protection}
										<dt class="text-muted-foreground">Protection</dt>
										<dd class="text-warning">
											{AUTOMATION_PROTECTION_LABEL[run.protection as AutomationProtection]} intervened
										</dd>
									{/if}
									{#if run.error}
										<dt class="text-muted-foreground">
											{run.status === 'skipped' ? 'Reason' : 'Error'}
										</dt>
										<dd class={run.status === 'failed' ? 'text-destructive' : ''}>{run.error}</dd>
									{/if}
								</dl>
								{#if run.conditions}
									{@const conds = run.conditions.conditions}
									<div class="grid gap-1">
										<p class="text-xs font-medium text-muted-foreground">
											Conditions {run.conditions.matched ? 'matched' : 'did not match'}
										</p>
										{#if conds.length}
											<ul class="grid gap-1 text-xs" aria-label="Conditions">
												{#each conds as c, i (i)}
													<li class="flex items-start gap-1.5">
														{#if i > 0 && c.group !== conds[i - 1].group}<span
																class="font-semibold text-link">OR</span
															>{/if}
														{#if c.passed}<CircleCheck
																class="mt-0.5 size-3.5 shrink-0 text-success"
																aria-label="Passed"
															/>{:else}<CircleX
																class="mt-0.5 size-3.5 shrink-0 text-destructive"
																aria-label="Not passed"
															/>{/if}
														<span class="[overflow-wrap:anywhere]">{c.text}</span>
													</li>
												{/each}
											</ul>
										{:else}
											<p class="text-xs text-muted-foreground">
												No conditions – the rule runs for every ticket.
											</p>
										{/if}
									</div>
								{/if}
								{#if run.actions.length}
									{@const notRun = run.actions.filter((a) => a.skipped).length}
									<p class="text-xs font-medium text-muted-foreground">
										Actions: {run.actions.length - notRun} attempted{notRun
											? `, ${notRun} not run`
											: ''}
									</p>
									<ul class="grid gap-1 text-xs" aria-label="Actions">
										{#each run.actions as a, i (i)}
											<li class="flex items-start gap-1.5">
												{#if !a.ok}<CircleX
														class="mt-0.5 size-3.5 shrink-0 text-destructive"
														aria-label="Failed"
													/>
												{:else if a.skipped}<CircleMinus
														class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
														aria-label="Not run"
													/>
												{:else if a.changed}<CircleCheck
														class="mt-0.5 size-3.5 shrink-0 text-success"
														aria-label="Changed"
													/>
												{:else}<CircleMinus
														class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
													/>{/if}
												<span class="[overflow-wrap:anywhere]"
													>{a.summary}{#if a.error}
														– {a.error}{/if}</span
												>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</Card>
				</li>
			{/each}
		</ul>
		{#if data.more}
			<div class="flex justify-center">
				<Button variant="outline" onclick={() => apply({ before: String(data.runs.at(-1)!.id) })}
					>Older runs</Button
				>
			</div>
		{/if}
	{:else}
		<p
			class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
		>
			{page.url.search
				? 'No runs match these filters. Clear a filter to see more.'
				: 'No automation has run yet. Runs appear here when an enabled rule reacts to a ticket change.'}
		</p>
	{/if}
</div>
