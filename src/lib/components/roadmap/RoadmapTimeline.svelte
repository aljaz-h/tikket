<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import StatusBadge from '../StatusBadge.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import type { RoadmapCardData } from './RoadmapCard.svelte';
	import type { TicketStatus } from '$lib/shared/constants';
	import { COLUMN_CAP, timelineAxis } from '$lib/shared/roadmap-view';
	import { formatDateTime, ticketPath, ticketRef } from '$lib/shared/format';

	type Card = RoadmapCardData;
	interface Props {
		projectKey: string;
		now: Date;
		open: Card[];
		planned: Card[];
		inProgress: Card[];
		completed: Card[];
		totals: { open: number; planned: number; in_progress: number; completed: number };
		/** Whether the Open / Unplanned section is part of this roadmap. */
		showOpen: boolean;
		filtered: boolean;
	}
	let { projectKey, now, open, planned, inProgress, completed, totals, showOpen, filtered }: Props =
		$props();

	let expanded = $state(false);

	const sections = $derived([
		{
			id: 'in_progress',
			label: 'In Progress',
			status: 'in_progress',
			cards: inProgress,
			total: totals.in_progress
		},
		{ id: 'planned', label: 'Planned', status: 'planned', cards: planned, total: totals.planned },
		...(showOpen
			? [{ id: 'open', label: 'Open / Unplanned', status: 'open', cards: open, total: totals.open }]
			: []),
		{
			id: 'completed',
			label: 'Recently completed',
			status: 'completed',
			cards: completed,
			total: totals.completed
		}
	] as const);

	const all = $derived([...open, ...planned, ...inProgress, ...completed]);
	const axis = $derived(
		timelineAxis(
			all.flatMap((c) => [c.createdAt, c.startedAt, c.plannedAt, c.completedAt ?? c.createdAt]),
			now
		)
	);
	const dayMonth = (d: Date | string) =>
		new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(d));

	/** What a row draws on the track, and the text after it. */
	function mark(c: Card) {
		if (c.status === 'completed') {
			const from = axis.pct(c.startedAt);
			const to = axis.pct(c.completedAt ?? c.createdAt);
			return {
				kind: 'bar' as const,
				color: 'var(--tone-completed)',
				left: from,
				width: Math.max(to - from, 0.8),
				end: to,
				label: `${dayMonth(c.startedAt)} → ${dayMonth(c.completedAt ?? c.createdAt)}`
			};
		}
		if (c.status === 'in_progress') {
			const from = axis.pct(c.startedAt);
			return {
				kind: 'bar' as const,
				color: 'var(--tone-progress)',
				left: from,
				width: Math.max(axis.todayPct - from, 0.8),
				end: axis.todayPct,
				label: `Started ${dayMonth(c.startedAt)}`
			};
		}
		if (c.status === 'planned')
			return {
				kind: 'diamond' as const,
				left: axis.pct(c.plannedAt),
				end: axis.pct(c.plannedAt),
				label: `Planned ${dayMonth(c.plannedAt)}`
			};
		return {
			kind: 'ring' as const,
			left: axis.pct(c.createdAt),
			end: axis.pct(c.createdAt),
			label: `Created ${dayMonth(c.createdAt)}`
		};
	}
	const exact = (c: Card) =>
		[
			`Created ${formatDateTime(c.createdAt)}`,
			c.status === 'planned' ? `Planned ${formatDateTime(c.plannedAt)}` : null,
			c.status === 'in_progress' || c.status === 'completed'
				? `Started ${formatDateTime(c.startedAt)}`
				: null,
			c.completedAt && c.status === 'completed' ? `Done ${formatDateTime(c.completedAt)}` : null
		]
			.filter(Boolean)
			.join(' · ');
</script>

<div class="grid gap-3">
	<ul
		class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
		aria-label="Legend"
	>
		<li class="inline-flex items-center gap-2">
			<span class="h-2 w-5 rounded-sm" style:background="var(--tone-completed)"></span>Created →
			done
		</li>
		<li class="inline-flex items-center gap-2">
			<span class="h-2 w-5 rounded-sm" style:background="var(--tone-progress)"></span>Started →
			today
		</li>
		<li class="inline-flex items-center gap-2">
			<span class="size-2.5 rotate-45" style:background="var(--tone-planned)"></span>Planned
		</li>
		<li class="inline-flex items-center gap-2">
			<span class="size-2.5 rounded-full border-2" style:border-color="var(--tone-open)"></span>Open
		</li>
	</ul>

	<!-- A scrollable region must be focusable so keyboard users can scroll it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="overflow-x-auto rounded-xl border border-border bg-surface"
		role="region"
		aria-label="Roadmap timeline"
		tabindex="0"
	>
		<div class="relative min-w-[56rem]">
			<!-- Axis -->
			<div
				class="grid grid-cols-[340px_minmax(0,1fr)] border-b border-border text-xs text-muted-foreground"
			>
				<div class="sticky left-0 z-20 bg-surface px-4 py-3 font-medium tracking-wide uppercase">
					Ticket
				</div>
				<div class="relative h-12" aria-hidden="true">
					{#each axis.weeks as w (w.at.getTime())}
						<span
							class="absolute top-0 bottom-0 border-l border-border pt-3 pl-1.5"
							style:left="{w.pct}%">{dayMonth(w.at)}</span
						>
					{/each}
					<span
						class="absolute top-1.5 -translate-x-1/2 rounded-md bg-primary px-1.5 py-0.5 text-[0.6875rem] font-semibold text-primary-foreground"
						style:left="{axis.todayPct}%">Today</span
					>
				</div>
			</div>

			{#each sections as section (section.id)}
				{@const capped = section.id === 'completed' && !expanded ? COLUMN_CAP : Infinity}
				{@const shown = section.cards.slice(0, capped)}
				<div class="grid grid-cols-[340px_minmax(0,1fr)] border-b border-border bg-surface-2/60">
					<div
						class="sticky left-0 z-10 flex items-center gap-2 bg-surface-2 px-4 py-2 text-sm font-semibold"
					>
						<StatusBadge status={section.status as TicketStatus} iconOnly />{section.label}
						<span class="font-normal text-muted-foreground tabular-nums"
							>{filtered ? section.cards.length : section.total}</span
						>
					</div>
					<div></div>
				</div>
				{#each shown as c (c.number)}
					{@const m = mark(c)}
					<div
						class="group grid grid-cols-[340px_minmax(0,1fr)] border-b border-border/60 hover:bg-hover"
						title={exact(c)}
					>
						<div
							class="sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-surface px-4 py-2 group-hover:bg-hover"
						>
							<span class="shrink-0 font-mono text-xs text-muted-foreground"
								>{ticketRef(projectKey, c.number)}</span
							>
							<a
								href={ticketPath(projectKey, c.number)}
								class="min-w-0 flex-1 truncate text-sm hover:underline">{c.title}</a
							>
							{#if c.creator}
								<span
									role="img"
									aria-label="Created by {c.creator.name}"
									title="Created by {c.creator.name}"
								>
									<UserAvatar
										user={{ displayName: c.creator.name, avatarId: c.creator.avatarId }}
										size="xs"
									/>
								</span>
							{/if}
						</div>
						<div class="relative min-h-10">
							{#each axis.weeks as w (w.at.getTime())}
								<span
									class="absolute inset-y-0 border-l border-border/50"
									style:left="{w.pct}%"
									aria-hidden="true"
								></span>
							{/each}
							<span
								class="absolute inset-y-0 w-0.5 bg-primary/70"
								style:left="{axis.todayPct}%"
								aria-hidden="true"
							></span>
							{#if m.kind === 'bar'}
								<span
									class="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm"
									style:left="{m.left}%"
									style:width="{m.width}%"
									style:background={m.color}
									aria-hidden="true"
								></span>
							{:else if m.kind === 'diamond'}
								<span
									class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45"
									style:left="{m.left}%"
									style:background="var(--tone-planned)"
									aria-hidden="true"
								></span>
							{:else}
								<span
									class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
									style:left="{m.left}%"
									style:border-color="var(--tone-open)"
									aria-hidden="true"
								></span>
							{/if}
							<span
								class="absolute top-1/2 -translate-y-1/2 text-xs whitespace-nowrap text-muted-foreground"
								style:left={m.end > 78 ? undefined : `calc(${m.end}% + 12px)`}
								style:right={m.end > 78 ? `calc(${100 - m.left}% + 10px)` : undefined}
								>{m.label}</span
							>
						</div>
					</div>
				{:else}
					<div class="grid grid-cols-[340px_minmax(0,1fr)] border-b border-border/60">
						<p class="sticky left-0 bg-surface px-4 py-3 text-sm text-muted-foreground">
							No tickets
						</p>
						<div></div>
					</div>
				{/each}
				{#if section.id === 'completed' && section.cards.length > COLUMN_CAP}
					<div class="sticky left-0 w-fit px-3 py-3">
						<button
							type="button"
							aria-expanded={expanded}
							onclick={() => (expanded = !expanded)}
							class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground pointer-coarse:h-11"
						>
							{expanded ? 'Show less' : `Show ${section.cards.length - COLUMN_CAP} more completed`}
							<ChevronDown class="size-4 {expanded ? 'rotate-180' : ''}" />
						</button>
					</div>
				{/if}
			{/each}
		</div>
	</div>
</div>
