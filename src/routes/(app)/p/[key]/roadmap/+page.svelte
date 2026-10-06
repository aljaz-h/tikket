<script lang="ts">
	import ArrowBigUp from '@lucide/svelte/icons/arrow-big-up';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import { STATUS_META, type TicketType } from '$lib/shared/constants';
	import { formatDate, ticketPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const columns = [
		{ status: 'planned', hint: 'Accepted for future development' },
		{ status: 'in_progress', hint: 'Currently being implemented' },
		{ status: 'completed', hint: 'Recently finished features and fixes' }
	] as const;
</script>

<div class="grid gap-4">
	<p class="text-sm text-muted-foreground">
		The roadmap is generated automatically from ticket statuses. Vote on the requests that matter
		most to you.
	</p>
	<div class="grid gap-4 md:grid-cols-3">
		{#each columns as col (col.status)}
			{@const items = data.roadmap[col.status]}
			<section
				class="flex flex-col rounded-xl border border-border bg-surface-2/60"
				aria-labelledby="col-{col.status}"
			>
				<header class="border-b border-border px-4 py-3">
					<h2 id="col-{col.status}" class="flex items-center gap-2 text-sm font-semibold">
						<StatusBadge status={col.status} iconOnly />{STATUS_META[col.status].label}
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
								{#if data.project.votingEnabled}
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
