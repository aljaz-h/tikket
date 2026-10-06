<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { projectPath, ticketPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
</script>

<div class="mx-auto grid max-w-3xl gap-6">
	<PageHeader title="Search" />
	<form method="GET" class="flex gap-2" role="search">
		<Input type="search" name="q" value={data.q} placeholder="Search tickets and projects" aria-label="Search" class="flex-1" />
		<Button type="submit"><Search /> Search</Button>
	</form>
	{#if data.results}
		{#if data.results.projects.length}
			<section class="grid gap-2">
				<h2 class="text-sm font-semibold">Projects</h2>
				<ul class="divide-y divide-border rounded-xl border border-border bg-surface">
					{#each data.results.projects as p (p.key)}
						<li><a href={projectPath(p.key)} class="flex items-center gap-3 px-4 py-2.5 hover:bg-hover"><ProjectIcon project={p} />{p.name}<span class="ml-auto font-mono text-xs text-muted-foreground">{p.key}</span></a></li>
					{/each}
				</ul>
			</section>
		{/if}
		<section class="grid gap-2">
			<h2 class="text-sm font-semibold">Tickets</h2>
			{#if data.results.tickets.length}
				<ul class="divide-y divide-border rounded-xl border border-border bg-surface">
					{#each data.results.tickets as t (`${t.projectKey}-${t.number}`)}
						<li>
							<a href={ticketPath(t.projectKey, t.number)} class="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
								<StatusBadge status={t.status} iconOnly />
								<span class="w-20 shrink-0 font-mono text-xs text-muted-foreground">{ticketRef(t.projectKey, t.number)}</span>
								<span class="min-w-0 flex-1 truncate">{t.title}</span>
								<span class="hidden text-xs text-muted-foreground sm:inline">{t.projectName}</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<EmptyState icon={Search} title="No tickets found" description="Try other words or a ticket number like SPL-12." />
			{/if}
		</section>
	{/if}
</div>
