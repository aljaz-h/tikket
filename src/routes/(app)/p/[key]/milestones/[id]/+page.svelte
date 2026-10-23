<script lang="ts">
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import X from '@lucide/svelte/icons/x';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import TicketPicker from '$lib/components/planning/TicketPicker.svelte';
	import ProgressBar from '$lib/components/planning/ProgressBar.svelte';
	import PlanningStatus from '$lib/components/planning/PlanningStatus.svelte';
	import MilestoneDialog from '$lib/components/planning/MilestoneDialog.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import { STATUS_META } from '$lib/shared/constants';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import { describeProjectActivity } from '$lib/shared/project-activity';

	let { data } = $props();
	const m = $derived(data.milestone);
	const key = $derived(data.project.key);
	let editOpen = $state(false);
	const remaining = $derived(data.tickets.filter((t) => !STATUS_META[t.status].resolved));
	const done = $derived(data.tickets.filter((t) => STATUS_META[t.status].resolved));
	const actions = $derived(
		m.status === 'open'
			? [
					{ status: 'completed', label: 'Mark completed' },
					{ status: 'archived', label: 'Archive' }
				]
			: m.status === 'completed'
				? [
						{ status: 'open', label: 'Reopen' },
						{ status: 'archived', label: 'Archive' }
					]
				: [{ status: 'open', label: 'Restore' }]
	);
</script>

{#snippet ticketList(items: typeof data.tickets, label: string)}
	<div class="grid gap-1.5">
		<p class="text-xs font-medium text-muted-foreground">{label} · {items.length}</p>
		<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
			{#each items as t (t.id)}
				<li class="flex items-center gap-3 px-3 py-2 sm:px-4">
					<StatusBadge status={t.status} iconOnly />
					<a href={ticketPath(key, t.number)} class="min-w-0 flex-1 hover:underline">
						<span class="font-mono text-xs text-muted-foreground">{ticketRef(key, t.number)}</span>
						<span class="[overflow-wrap:anywhere]">{t.title}</span>
					</a>
					{#if data.canEdit}
						<form
							method="POST"
							action="?/removeTicket"
							use:enhance={quickSubmit({ success: 'Removed from milestone' })}
						>
							<input type="hidden" name="ticket" value={t.number} />
							<Button
								type="submit"
								size="icon-xs"
								variant="subtle"
								aria-label="Remove {ticketRef(key, t.number)} from this milestone"><X /></Button
							>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<div class="grid gap-6">
	<a
		href={projectPath(key, 'milestones')}
		class="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" /> All milestones</a
	>
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div class="grid min-w-0 gap-1.5">
			<h2 class="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
				<span class="[overflow-wrap:anywhere]">{m.name}</span>
				<PlanningStatus kind="milestone" status={m.status} />
			</h2>
			<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
				<CalendarDays class="size-4" />{m.targetDate
					? `Target ${formatDate(m.targetDate)}`
					: 'No target date'}
			</p>
			{#if m.description}<p class="max-w-2xl text-sm whitespace-pre-line">{m.description}</p>{/if}
		</div>
		{#if data.canEdit}
			<div class="flex flex-wrap gap-2">
				<Button variant="secondary" onclick={() => (editOpen = true)}><Pencil /> Edit</Button>
				{#each actions as a (a.status)}
					<form
						method="POST"
						action="?/status"
						use:enhance={quickSubmit({ success: 'Milestone updated' })}
					>
						<input type="hidden" name="status" value={a.status} />
						<Button type="submit" variant={a.status === 'completed' ? 'default' : 'outline'}
							>{a.label}</Button
						>
					</form>
				{/each}
			</div>
		{/if}
	</header>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="grid content-start gap-6">
			<Card class="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<ProgressBar progress={data.progress} label="Milestone progress" />
				<dl class="flex gap-6 text-sm">
					<div>
						<dt class="text-xs text-muted-foreground">Total</dt>
						<dd class="font-semibold tabular-nums">{data.progress.total}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Completed</dt>
						<dd class="font-semibold tabular-nums">{data.progress.completed}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Remaining</dt>
						<dd class="font-semibold tabular-nums">{remaining.length}</dd>
					</div>
				</dl>
			</Card>
			{#if data.canEdit && m.status === 'open'}
				<div class="flex flex-wrap items-center gap-2">
					<TicketPicker
						projectKey={key}
						tickets={data.pickable}
						noun="milestone"
						action="?/addTickets"
					/>
					<span class="text-xs text-muted-foreground">or add by number:</span>
					<form
						method="POST"
						action="?/addTicket"
						class="flex flex-wrap gap-2"
						use:enhance={quickSubmit({ success: 'Ticket added', reset: true })}
					>
						<Input
							name="ticket"
							placeholder="{key}-12"
							aria-label="Ticket to add"
							class="min-w-0 flex-1 font-mono sm:max-w-xs"
						/>
						<Button type="submit" variant="secondary">Add ticket</Button>
					</form>
				</div>
			{/if}
			{#if data.tickets.length}
				{#if remaining.length}{@render ticketList(remaining, 'Remaining')}{/if}
				{#if done.length}{@render ticketList(done, 'Resolved')}{/if}
			{:else}
				<p
					class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
				>
					No tickets yet. Add them here, from a ticket, or with bulk actions in the ticket list.
				</p>
			{/if}
		</div>
		<aside>
			<Card class="grid gap-2 p-4">
				<h3 class="text-sm font-semibold">History</h3>
				<ol class="grid gap-2 text-sm">
					{#each data.activity as a (a.id)}
						<li class="text-muted-foreground">
							<span class="font-medium text-foreground">{a.actorName ?? 'Someone'}</span>
							{describeProjectActivity(a.type, a.data)} · <TimeAgo date={a.createdAt} />
						</li>
					{:else}
						<li class="text-muted-foreground">No changes recorded.</li>
					{/each}
				</ol>
			</Card>
		</aside>
	</div>
</div>

<MilestoneDialog bind:open={editOpen} action="?/update" milestone={m} />
