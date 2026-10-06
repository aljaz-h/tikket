<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Rocket from '@lucide/svelte/icons/rocket';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ProgressBar from '$lib/components/planning/ProgressBar.svelte';
	import PlanningStatus from '$lib/components/planning/PlanningStatus.svelte';
	import ReleaseDialog from '$lib/components/planning/ReleaseDialog.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatDate, projectPath } from '$lib/shared/format';

	let { data } = $props();
	let createOpen = $state(false);
	const upcoming = $derived(
		data.releases.filter((r) => r.status === 'planned' || r.status === 'in_progress')
	);
	const past = $derived(
		data.releases.filter((r) => r.status === 'released' || r.status === 'cancelled')
	);
	const base = $derived(projectPath(data.project.key, 'releases'));
</script>

{#snippet list(items: typeof data.releases)}
	<ul class="grid gap-3 md:grid-cols-2">
		{#each items as r (r.id)}
			<li>
				<a href="{base}/{r.id}" class="block h-full rounded-xl focus-visible:outline-2">
					<Card class="grid h-full gap-3 p-4 transition-colors hover:border-border-strong">
						<div class="flex items-start justify-between gap-3">
							<h3 class="min-w-0 truncate text-base font-semibold">{r.version}</h3>
							<PlanningStatus kind="release" status={r.status} />
						</div>
						<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
							<CalendarDays class="size-3.5" />
							{#if r.status === 'released'}Released {formatDate(r.releaseDate)}
							{:else if r.targetDate}Target {formatDate(r.targetDate)}
							{:else}No target date{/if}
						</p>
						<ProgressBar progress={r.progress} label="Progress of {r.version}" compact />
					</Card>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="grid gap-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			Plan versions, collect the tickets that go into them and publish release notes to the
			<a href={projectPath(data.project.key, 'changelog')} class="text-link hover:underline"
				>changelog</a
			>.
		</p>
		{#if data.canEdit}<Button onclick={() => (createOpen = true)}><Plus /> New release</Button>{/if}
	</div>

	{#if data.releases.length}
		<section class="grid gap-3" aria-labelledby="upcoming-releases">
			<h2 id="upcoming-releases" class="text-sm font-semibold">Upcoming</h2>
			{#if upcoming.length}{@render list(upcoming)}{:else}
				<p class="text-sm text-muted-foreground">No planned releases.</p>
			{/if}
		</section>
		{#if past.length}
			<section class="grid gap-3" aria-labelledby="past-releases">
				<h2 id="past-releases" class="text-sm font-semibold">Released and cancelled</h2>
				{@render list(past)}
			</section>
		{/if}
	{:else}
		<EmptyState
			icon={Rocket}
			title="No releases yet"
			description="Create a release such as “v1.2.0”, assign tickets to it and publish it when it ships."
		>
			{#if data.canEdit}<Button onclick={() => (createOpen = true)}><Plus /> New release</Button
				>{/if}
		</EmptyState>
	{/if}
</div>

<ReleaseDialog bind:open={createOpen} action="?/create" />
