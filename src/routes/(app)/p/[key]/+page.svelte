<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Plus from '@lucide/svelte/icons/plus';
	import TicketList from '$lib/components/TicketList.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketStatus, TicketType } from '$lib/shared/constants';

	let { data } = $props();
	const key = $derived(data.project.key);
</script>

<div class="grid gap-8">
	{#if data.project.description}
		<p class="max-w-3xl text-[0.9375rem] text-muted-foreground">{data.project.description}</p>
	{/if}

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each [{ label: 'Open', value: data.stats.open, status: 'open' }, { label: 'Planned', value: data.stats.planned, status: 'planned' }, { label: 'In progress', value: data.stats.inProgress, status: 'in_progress' }, { label: 'Completed', value: data.stats.completed, status: 'completed' }] as stat (stat.label)}
			<a
				href="{projectPath(key, 'tickets')}?status={stat.status}"
				class="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
			>
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<StatusBadge status={stat.status as TicketStatus} iconOnly />{stat.label}
				</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
			</a>
		{/each}
	</div>

	<div class="grid gap-8 xl:grid-cols-3">
		<section class="grid content-start gap-3 xl:col-span-2">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Recently updated</h2>
				<a
					href={projectPath(key, 'tickets')}
					class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>All tickets <ArrowRight class="size-3.5" /></a
				>
			</div>
			{#if data.recent.length}
				<TicketList tickets={data.recent} label="Recently updated tickets" />
			{:else}
				<EmptyState
					icon={Inbox}
					title="No tickets yet"
					description="Be the first to report a bug or share an idea."
				>
					{#if data.permissions.canSubmit}<Button href="/new?project={key}"
							><Plus /> New ticket</Button
						>{/if}
				</EmptyState>
			{/if}
		</section>

		<aside class="grid content-start gap-6">
			<section class="grid gap-3">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">Coming up</h2>
					<a
						href={projectPath(key, 'roadmap')}
						class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>Roadmap <ArrowRight class="size-3.5" /></a
					>
				</div>
				<Card class="divide-y divide-border">
					{#each data.upcoming as t (t.number)}
						<a
							href={ticketPath(key, t.number)}
							class="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-hover"
						>
							<StatusBadge status={t.status as TicketStatus} iconOnly />
							<span class="min-w-0 flex-1 truncate">{t.title}</span>
							<TypeBadge type={t.type as TicketType} iconOnly />
						</a>
					{:else}
						<p class="px-3 py-6 text-center text-sm text-muted-foreground">Nothing planned yet.</p>
					{/each}
				</Card>
			</section>
			{#if data.project.votingEnabled}
				<section class="grid gap-3">
					<h2 class="text-sm font-semibold">Most requested</h2>
					<Card class="divide-y divide-border">
						{#each data.topVoted.filter((t) => t.voteCount > 0) as t (t.number)}
							<a
								href={ticketPath(key, t.number)}
								class="flex items-center gap-3 px-3 py-2.5 hover:bg-hover"
							>
								<span
									class="flex w-9 shrink-0 flex-col items-center rounded-md border border-border py-0.5 text-xs font-semibold tabular-nums"
									><ArrowBigUp class="size-3.5 text-muted-foreground" />{t.voteCount}</span
								>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm">{t.title}</span>
									<span class="font-mono text-xs text-muted-foreground"
										>{ticketRef(key, t.number)}</span
									>
								</span>
							</a>
						{:else}
							<p class="px-3 py-6 text-center text-sm text-muted-foreground">
								Upvote tickets you care about.
							</p>
						{/each}
					</Card>
				</section>
			{/if}
			{#if data.changelog.length}
				<section class="grid gap-3">
					<div class="flex items-center justify-between">
						<h2 class="text-sm font-semibold">Latest releases</h2>
						<a
							href={projectPath(key, 'changelog')}
							class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
							>Changelog <ArrowRight class="size-3.5" /></a
						>
					</div>
					{#each data.changelog as entry (entry.id)}
						<Card class="p-4">
							<p class="font-medium">{entry.version}</p>
							<p class="text-xs text-muted-foreground">
								{formatDate(entry.releaseDate)} · {entry.tickets.length} tickets
							</p>
							{#if entry.summaryHtml}<RichText
									html={entry.summaryHtml}
									class="mt-2 line-clamp-3 text-sm text-muted-foreground"
								/>{/if}
						</Card>
					{/each}
				</section>
			{/if}
		</aside>
	</div>
</div>
