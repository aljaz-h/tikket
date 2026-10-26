<script lang="ts">
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { ms } from '$lib/motion';
	import { enhance } from '$app/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Rocket from '@lucide/svelte/icons/rocket';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import TicketPicker from '$lib/components/planning/TicketPicker.svelte';
	import ProgressBar from '$lib/components/planning/ProgressBar.svelte';
	import PlanningStatus from '$lib/components/planning/PlanningStatus.svelte';
	import ReleaseDialog from '$lib/components/planning/ReleaseDialog.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import { STATUS_META, TICKET_STATUSES } from '$lib/shared/constants';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import { describeProjectActivity } from '$lib/shared/project-activity';

	let { data } = $props();
	const r = $derived(data.release);
	const key = $derived(data.project.key);
	let editOpen = $state(false);
	let deleteOpen = $state(false);
	const open = $derived(r.status === 'planned' || r.status === 'in_progress');
	const groups = $derived(
		TICKET_STATUSES.map((s) => ({
			status: s,
			tickets: data.tickets.filter((t) => t.status === s)
		})).filter((g) => g.tickets.length)
	);
</script>

<div class="grid gap-6">
	<a
		href={projectPath(key, 'releases')}
		class="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" /> All releases</a
	>

	<header class="flex flex-wrap items-start justify-between gap-4">
		<div class="grid min-w-0 gap-1.5">
			<h2 class="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
				<span class="[overflow-wrap:anywhere]">{r.version}</span>
				<PlanningStatus kind="release" status={r.status} />
			</h2>
			<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
				<span class="inline-flex items-center gap-1.5"
					><CalendarDays class="size-4" />
					{#if r.targetDate}Target {formatDate(r.targetDate)}{:else}No target date{/if}</span
				>
				{#if r.status === 'released'}<span>Released {formatDate(r.releaseDate)}</span>{/if}
				<span>{data.progress.total} ticket{data.progress.total === 1 ? '' : 's'}</span>
			</p>
		</div>
		{#if data.canEdit}
			<div class="flex flex-wrap gap-2">
				<Button variant="secondary" onclick={() => (editOpen = true)}><Pencil /> Edit</Button>
				{#if r.status !== 'released'}
					<Button variant="ghost" onclick={() => (deleteOpen = true)} aria-label="Delete release"
						><Trash2 /></Button
					>
				{/if}
				{#if data.canPublish && open}
					<Button href={projectPath(key, `releases/${r.id}/publish`)}
						><Rocket /> Publish release</Button
					>
				{/if}
			</div>
		{/if}
	</header>

	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="grid content-start gap-6">
			<Card class="grid gap-3 p-5">
				<h3 class="text-sm font-semibold">Progress</h3>
				<ProgressBar progress={data.progress} label="Release progress" />
			</Card>

			<section class="grid gap-3" aria-labelledby="release-tickets">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h3 id="release-tickets" class="text-sm font-semibold">Tickets</h3>
				</div>
				{#if data.canEdit && open}
					<div class="flex flex-wrap items-center gap-2">
						<TicketPicker
							projectKey={key}
							tickets={data.pickable}
							noun="release"
							action="?/addTickets"
						/>
						<span class="text-xs text-muted-foreground">or add by number:</span>
						<form
							method="POST"
							action="?/addTickets"
							class="flex flex-wrap gap-2"
							use:enhance={quickSubmit({ success: 'Tickets added', reset: true })}
						>
							<Input
								name="tickets"
								placeholder="{key}-12, {key}-18 …"
								aria-label="Tickets to add"
								class="min-w-0 flex-1 font-mono sm:max-w-sm"
							/>
							<Button type="submit" variant="secondary">Add tickets</Button>
						</form>
					</div>
				{/if}
				{#each groups as group (group.status)}
					<div class="grid gap-1.5">
						<p class="text-xs font-medium text-muted-foreground">
							{STATUS_META[group.status].label} · {group.tickets.length}
						</p>
						<ul
							class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
						>
							{#each group.tickets as t (t.id)}
								<li
									transition:slide|local={{ duration: ms(180) }}
									animate:flip={{ duration: ms(180) }}
									class="flex items-center gap-3 px-3 py-2 sm:px-4"
								>
									<StatusBadge status={t.status} iconOnly />
									<a href={ticketPath(key, t.number)} class="min-w-0 flex-1 hover:underline">
										<span class="font-mono text-xs text-muted-foreground"
											>{ticketRef(key, t.number)}</span
										>
										<span class="[overflow-wrap:anywhere]">{t.title}</span>
									</a>
									<span class="hidden sm:block"><TypeBadge type={t.type} /></span>
									{#if data.canEdit && open}
										<form
											method="POST"
											action="?/removeTicket"
											use:enhance={quickSubmit({ success: 'Removed from release' })}
										>
											<input type="hidden" name="ticket" value={t.number} />
											<Button
												type="submit"
												size="icon-xs"
												variant="subtle"
												aria-label="Remove {ticketRef(key, t.number)} from this release"
												><X /></Button
											>
										</form>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{:else}
					<p
						class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
					>
						No tickets yet. Add them here, from a ticket, or with bulk actions in the ticket list.
					</p>
				{/each}
			</section>
		</div>

		<aside class="grid content-start gap-4">
			<Card class="grid gap-2 p-4">
				<h3 class="text-sm font-semibold">Release notes</h3>
				{#if r.summaryHtml}<RichText html={r.summaryHtml} class="text-sm" />{:else}
					<p class="text-sm text-muted-foreground">No notes yet.</p>
				{/if}
			</Card>
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

<ReleaseDialog bind:open={editOpen} action="?/update" release={r} />
<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete {r.version}?"
	description="Its tickets stay as they are and simply lose their target release."
	confirmLabel="Delete release"
	destructive
	action="?/delete"
	successMessage="Release deleted"
/>
