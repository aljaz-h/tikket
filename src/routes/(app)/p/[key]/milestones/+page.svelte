<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Flag from '@lucide/svelte/icons/flag';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgressBar from '$lib/components/planning/ProgressBar.svelte';
	import PlanningStatus from '$lib/components/planning/PlanningStatus.svelte';
	import MilestoneDialog from '$lib/components/planning/MilestoneDialog.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatDate, projectPath } from '$lib/shared/format';

	let { data } = $props();
	let createOpen = $state(false);
	let showArchived = $state(false);
	const visible = $derived(data.milestones.filter((m) => showArchived || m.status !== 'archived'));
	const archivedCount = $derived(data.milestones.filter((m) => m.status === 'archived').length);
	const base = $derived(projectPath(data.project.key, 'milestones'));
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			Goals that group related work. Progress follows the status of their tickets.
		</p>
		{#if data.canEdit}<Button onclick={() => (createOpen = true)}><Plus /> New milestone</Button
			>{/if}
	</div>

	{#if visible.length}
		<ul class="grid gap-3 md:grid-cols-2">
			{#each visible as m (m.id)}
				<li>
					<a href="{base}/{m.id}" class="block h-full rounded-xl">
						<Card class="grid h-full gap-3 p-4 transition-colors hover:border-border-strong">
							<div class="flex items-start justify-between gap-3">
								<h3 class="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{m.name}</h3>
								<PlanningStatus kind="milestone" status={m.status} />
							</div>
							{#if m.description}<p class="line-clamp-2 text-sm text-muted-foreground">
									{m.description}
								</p>{/if}
							<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
								<CalendarDays class="size-3.5" />
								{m.targetDate ? `Target ${formatDate(m.targetDate)}` : 'No target date'}
								{#if m.progress.total}· {m.progress.total - m.progress.completed} remaining{/if}
							</p>
							<ProgressBar progress={m.progress} label="Progress of {m.name}" compact />
						</Card>
					</a>
				</li>
			{/each}
		</ul>
	{:else if !data.milestones.length}
		<EmptyState
			icon={Flag}
			title="No milestones yet"
			description="Group related tickets under a goal and follow its progress."
		>
			{#if data.canEdit}<Button onclick={() => (createOpen = true)}><Plus /> New milestone</Button
				>{/if}
		</EmptyState>
	{:else}
		<p class="text-sm text-muted-foreground">All milestones are archived.</p>
	{/if}
	{#if archivedCount}
		<Button variant="ghost" size="sm" class="w-fit" onclick={() => (showArchived = !showArchived)}>
			{showArchived ? 'Hide' : 'Show'}
			{archivedCount} archived
		</Button>
	{/if}
</div>

<MilestoneDialog bind:open={createOpen} action="?/create" />
