<script lang="ts">
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import Flag from '@lucide/svelte/icons/flag';
	import Package from '@lucide/svelte/icons/package';
	import Lock from '@lucide/svelte/icons/lock';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import {
		ROADMAP_AUDIENCE_LABEL,
		STATUS_META,
		type TicketPriority,
		type TicketType
	} from '$lib/shared/constants';
	import { formatDate, projectPath, ticketPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const columns = [
		{ status: 'planned', hint: 'Accepted for future development' },
		{ status: 'in_progress', hint: 'Currently being implemented' },
		{ status: 'completed', hint: 'Finished in the last 90 days' }
	] as const;
	const accent = $derived(data.project.accentColor);
	const r = $derived(data.roadmap);
	const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
</script>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-sm text-muted-foreground">
			The roadmap is generated automatically from ticket statuses.{#if data.project.votingEnabled && r.show.votes}
				Vote on the requests that matter most to you.{/if}
		</p>
		{#if data.permissions.isStaff || data.permissions.isOwner}
			<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
				<Lock class="size-3.5" /> Visible to: {ROADMAP_AUDIENCE_LABEL[data.audience]}
				{#if data.permissions.isOwner}·
					<a
						href={projectPath(data.project.key, 'settings/roadmap')}
						class="text-link hover:underline">Change</a
					>{/if}
			</span>
		{/if}
	</div>

	{#if r.releases.length || r.milestones.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#if r.releases.length}
				<section
					class="rounded-xl border border-border bg-surface p-4"
					aria-labelledby="rm-releases"
				>
					<h2 id="rm-releases" class="mb-3 flex items-center gap-2 text-sm font-semibold">
						<Package class="size-4 text-muted-foreground" /> Upcoming releases
					</h2>
					<ul class="grid gap-3">
						{#each r.releases as rel (rel.id)}
							<li class="grid gap-1.5">
								<div class="flex items-baseline justify-between gap-2 text-sm">
									<span class="font-medium [overflow-wrap:anywhere]">{rel.version}</span>
									<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
										{rel.done}/{rel.total}{#if rel.targetDate}
											· {formatDate(rel.targetDate)}{/if}
									</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-primary"
										style:width="{pct(rel.done, rel.total)}%"
										style:background={accent ?? undefined}
									></div>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if r.milestones.length}
				<section
					class="rounded-xl border border-border bg-surface p-4"
					aria-labelledby="rm-milestones"
				>
					<h2 id="rm-milestones" class="mb-3 flex items-center gap-2 text-sm font-semibold">
						<Flag class="size-4 text-muted-foreground" /> Milestones
					</h2>
					<ul class="grid gap-3">
						{#each r.milestones as m (m.id)}
							<li class="grid gap-1.5">
								<div class="flex items-baseline justify-between gap-2 text-sm">
									<span class="font-medium [overflow-wrap:anywhere]">{m.name}</span>
									<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
										{m.done}/{m.total}{#if m.targetDate}
											· {formatDate(m.targetDate)}{/if}
									</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-primary"
										style:width="{pct(m.done, m.total)}%"
										style:background={accent ?? undefined}
									></div>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
	{/if}

	<div class="grid gap-4 md:grid-cols-3">
		{#each columns as col (col.status)}
			{@const items = r.columns[col.status]}
			<section
				class="flex flex-col rounded-xl border border-border bg-surface-2/60"
				aria-labelledby="col-{col.status}"
			>
				<header
					class="border-b border-border px-4 py-3"
					style:box-shadow={accent ? `inset 0 2px 0 ${accent}` : undefined}
				>
					<h2 id="col-{col.status}" class="flex items-center gap-2 text-sm font-semibold">
						<StatusBadge status={col.status} iconOnly />{col.status === 'completed'
							? 'Recently completed'
							: STATUS_META[col.status].label}
						<span class="font-normal text-muted-foreground tabular-nums">{items.length}</span>
					</h2>
					<p class="text-xs text-muted-foreground">{col.hint}</p>
				</header>
				<ul class="grid content-start gap-2 p-2">
					{#each items as t (t.number)}
						<li>
							<a
								href={ticketPath(data.project.key, t.number)}
								class="flex gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong"
							>
								{#if t.voteCount !== null}
									<span
										class="flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md border border-border text-xs font-semibold tabular-nums"
									>
										<ArrowBigUp class="size-3.5 text-muted-foreground" />{t.voteCount}
									</span>
								{/if}
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium [overflow-wrap:anywhere]">{t.title}</span>
									<span
										class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
									>
										<span class="font-mono">{ticketRef(data.project.key, t.number)}</span>
										<TypeBadge type={t.type as TicketType} />
										{#if t.priority}<PriorityBadge priority={t.priority as TicketPriority} />{/if}
										{#if t.release}<span class="inline-flex items-center gap-1"
												><Package class="size-3" />{t.release}</span
											>{/if}
										{#if t.milestone}<span class="inline-flex items-center gap-1"
												><Flag class="size-3" />{t.milestone}</span
											>{/if}
										{#if t.assignee}<span>· {t.assignee}</span>{/if}
										{#if t.status === 'completed' && t.completedAt}<span
												>Done {formatDate(t.completedAt)}</span
											>{/if}
									</span>
								</span>
							</a>
						</li>
					{:else}
						<li
							class="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground"
						>
							Nothing here yet
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>
