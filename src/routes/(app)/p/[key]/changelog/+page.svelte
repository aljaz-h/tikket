<script lang="ts">
	import Rocket from '@lucide/svelte/icons/rocket';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketType } from '$lib/shared/constants';

	let { data } = $props();
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">
			Release notes and the completed tickets that shipped with them.
		</p>
		{#if data.canManage}
			<Button href={projectPath(data.project.key, 'releases')} variant="secondary"
				><Settings2 /> Manage releases</Button
			>
		{/if}
	</div>

	{#if data.entries.length}
		<ol class="relative grid gap-6 border-l border-border pl-6">
			{#each data.entries as entry (entry.id)}
				<li class="relative">
					<span
						class="absolute top-1.5 -left-[1.95rem] flex size-4 items-center justify-center rounded-full border border-border bg-background"
					>
						<span class="size-1.5 rounded-full bg-primary"></span>
					</span>
					<Card class="p-5">
						<h2 class="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
							{entry.version}
						</h2>
						<p class="text-sm text-muted-foreground">{formatDate(entry.releaseDate)}</p>
						{#if entry.summaryHtml}<RichText html={entry.summaryHtml} class="mt-3 text-sm" />{/if}
						{#if entry.tickets.length}
							<ul class="mt-4 grid gap-1.5 border-t border-border pt-4">
								{#each entry.tickets as t (t.id)}
									<li class="flex items-center gap-2 text-sm">
										<TypeBadge type={t.type as TicketType} iconOnly />
										<a
											href={ticketPath(data.project.key, t.number)}
											class="min-w-0 truncate hover:underline"
										>
											<span class="font-mono text-xs text-muted-foreground"
												>{ticketRef(data.project.key, t.number)}</span
											>
											{t.title}
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>
				</li>
			{/each}
		</ol>
	{:else}
		<EmptyState
			icon={Rocket}
			title="No releases yet"
			description={data.canManage
				? 'Plan a release, assign tickets to it and publish it – it will appear here.'
				: 'Release notes will appear here.'}
		>
			{#if data.canManage}<Button href={projectPath(data.project.key, 'releases')}
					>Go to releases</Button
				>{/if}
		</EmptyState>
	{/if}
</div>
