<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import ProgressBar from '$lib/components/planning/ProgressBar.svelte';
	import PlanningStatus from '$lib/components/planning/PlanningStatus.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketPriority, TicketStatus, TicketType } from '$lib/shared/constants';

	let { data } = $props();
	const key = $derived(data.project.key);
	const tickets = $derived(projectPath(key, 'tickets'));
	const list = (q: Record<string, string | string[]>) => {
		// A throwaway value for building a link, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(q)) for (const x of [v].flat()) p.append(k, x);
		return `${tickets}?${p}`;
	};
	const unresolved = ['open', 'planned', 'in_progress', 'on_hold'];
	const m = $derived(data.management);
	const metrics = $derived([
		{ label: 'Open', value: data.stats.open, href: list({ status: 'open' }), status: 'open' },
		{
			label: 'Planned',
			value: data.stats.planned,
			href: list({ status: 'planned' }),
			status: 'planned'
		},
		{
			label: 'In progress',
			value: data.stats.inProgress,
			href: list({ status: 'in_progress' }),
			status: 'in_progress'
		},
		{
			label: 'Completed',
			value: data.stats.completed,
			href: list({ status: 'completed' }),
			status: 'completed'
		},
		...(m
			? [
					{
						label: 'Awaiting review',
						value: m.awaitingReview,
						href: list({ status: 'open', assignee: 'none' })
					},
					{
						label: 'Unassigned',
						value: m.unassigned,
						href: list({ status: unresolved, assignee: 'none' })
					},
					{
						label: 'High priority',
						value: m.highPriority,
						href: list({ status: unresolved, priority: ['high', 'critical'] }),
						emphasis: m.highPriority > 0
					}
				]
			: [])
	] as { label: string; value: number; href: string; status?: string; emphasis?: boolean }[]);
</script>

{#snippet ticketRows(
	items: {
		number: number;
		title: string;
		status: string;
		type: string;
		priority?: string;
		voteCount?: number;
		createdAt?: Date | string;
		completedAt?: Date | string | null;
	}[],
	empty: string,
	meta: 'created' | 'completed' | 'votes' | 'priority' = 'created'
)}
	{#if items.length}
		<ul class="divide-y divide-border">
			{#each items as t (t.number)}
				<li>
					<a
						href={ticketPath(key, t.number)}
						class="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-hover"
					>
						<StatusBadge status={t.status as TicketStatus} iconOnly />
						<span class="min-w-0 flex-1">
							<span class="block truncate">{t.title}</span>
							<span class="font-mono text-xs text-muted-foreground">{ticketRef(key, t.number)}</span
							>
						</span>
						{#if meta === 'votes'}
							<span class="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums"
								><ArrowBigUp class="size-3.5" />{t.voteCount}</span
							>
						{:else if meta === 'priority' && t.priority}
							<PriorityBadge priority={t.priority as TicketPriority} iconOnly />
						{:else if meta === 'completed' && t.completedAt}
							<TimeAgo date={t.completedAt} class="shrink-0 text-xs text-muted-foreground" />
						{:else if t.createdAt}
							<TimeAgo date={t.createdAt} class="shrink-0 text-xs text-muted-foreground" />
						{/if}
						<TypeBadge type={t.type as TicketType} iconOnly />
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="px-3 py-5 text-center text-sm text-muted-foreground">{empty}</p>
	{/if}
{/snippet}

{#snippet heading(title: string, href?: string, linkLabel?: string)}
	<div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
		<h2 class="text-sm font-semibold">{title}</h2>
		{#if href}<a
				{href}
				class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>{linkLabel ?? 'View all'} <ArrowRight class="size-3.5" /></a
			>{/if}
	</div>
{/snippet}

<div class="grid gap-6">
	{#if data.project.description}
		<p class="max-w-3xl text-[0.9375rem] text-muted-foreground">{data.project.description}</p>
	{/if}

	<ul
		class="grid grid-cols-2 gap-2 sm:grid-cols-4 {m ? 'xl:grid-cols-7' : ''}"
		aria-label="Ticket counts"
	>
		{#each metrics as stat (stat.label)}
			<li>
				<a
					href={stat.href}
					class="block h-full rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong {stat.emphasis
						? 'border-[color-mix(in_oklab,var(--tone-critical)_40%,transparent)]'
						: ''}"
				>
					<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
						{#if stat.status}<StatusBadge
								status={stat.status as TicketStatus}
								iconOnly
							/>{/if}{stat.label}
					</p>
					<p
						class="mt-0.5 text-xl font-semibold tabular-nums {stat.emphasis
							? 'text-[var(--tone-critical)]'
							: ''}"
					>
						{stat.value}
					</p>
				</a>
			</li>
		{/each}
	</ul>

	{#if m}
		<section aria-labelledby="attention" class="grid gap-3">
			<h2 id="attention" class="text-sm font-semibold">Needs attention</h2>
			<div class="grid gap-4 lg:grid-cols-3">
				<Card class="overflow-hidden">
					{@render heading(
						'New reports',
						list({ status: 'open', assignee: 'none', sort: 'newest' })
					)}
					{@render ticketRows(m.attention.newReports, 'Nothing new to review.')}
				</Card>
				<Card class="overflow-hidden">
					{@render heading(
						'Unassigned high priority',
						list({ status: unresolved, priority: ['high', 'critical'], assignee: 'none' })
					)}
					{@render ticketRows(
						m.attention.unassignedHigh,
						'All urgent tickets have an owner.',
						'priority'
					)}
				</Card>
				<Card class="overflow-hidden">
					{@render heading('Recently reopened')}
					{@render ticketRows(m.attention.reopened, 'No reopened tickets in the last 30 days.')}
				</Card>
			</div>
		</section>

		<div class="grid gap-4 lg:grid-cols-2">
			<Card class="overflow-hidden">
				{@render heading('Upcoming releases', projectPath(key, 'releases'), 'Releases')}
				{#if m.releases.length}
					<ul class="divide-y divide-border">
						{#each m.releases as r (r.id)}
							<li>
								<a
									href={projectPath(key, `releases/${r.id}`)}
									class="grid gap-2 px-3 py-2.5 hover:bg-hover"
								>
									<span class="flex items-center justify-between gap-2">
										<span class="truncate text-sm font-medium">{r.version}</span>
										<PlanningStatus kind="release" status={r.status} />
									</span>
									<span class="flex items-center gap-1.5 text-xs text-muted-foreground"
										><CalendarDays class="size-3.5" />{r.targetDate
											? formatDate(r.targetDate)
											: 'No target date'}</span
									>
									<ProgressBar progress={r.progress} label="Progress of {r.version}" compact />
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="px-3 py-5 text-center text-sm text-muted-foreground">
						No planned releases. <a
							class="text-link hover:underline"
							href={projectPath(key, 'releases')}>Plan one</a
						>.
					</p>
				{/if}
			</Card>
			<Card class="overflow-hidden">
				{@render heading('Active milestones', projectPath(key, 'milestones'), 'Milestones')}
				{#if m.milestones.length}
					<ul class="divide-y divide-border">
						{#each m.milestones as ms (ms.id)}
							<li>
								<a
									href={projectPath(key, `milestones/${ms.id}`)}
									class="grid gap-2 px-3 py-2.5 hover:bg-hover"
								>
									<span class="flex items-center justify-between gap-2">
										<span class="truncate text-sm font-medium">{ms.name}</span>
										<span class="shrink-0 text-xs text-muted-foreground tabular-nums"
											>{ms.progress.total - ms.progress.completed} remaining</span
										>
									</span>
									<ProgressBar progress={ms.progress} label="Progress of {ms.name}" compact />
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="px-3 py-5 text-center text-sm text-muted-foreground">No open milestones.</p>
				{/if}
			</Card>
		</div>
	{/if}

	<div class="grid gap-4 lg:grid-cols-3">
		<Card class="overflow-hidden">
			{@render heading('Coming up', projectPath(key, 'roadmap'), 'Roadmap')}
			{@render ticketRows(data.upcoming, 'Nothing planned yet.', 'priority')}
		</Card>
		<Card class="overflow-hidden">
			{@render heading('Recently completed', list({ status: 'completed', sort: 'recent' }))}
			{@render ticketRows(data.recentlyCompleted, 'Nothing completed yet.', 'completed')}
		</Card>
		{#if data.project.votingEnabled}
			<Card class="overflow-hidden">
				{@render heading('Most requested', list({ status: unresolved, sort: 'votes' }))}
				{@render ticketRows(data.mostRequested, 'Upvote tickets you care about.', 'votes')}
			</Card>
		{/if}
	</div>

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
			<div class="grid gap-3 md:grid-cols-2">
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
			</div>
		</section>
	{/if}
</div>
