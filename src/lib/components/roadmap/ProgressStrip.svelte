<script lang="ts">
	import type { Component } from 'svelte';
	import { formatDate } from '$lib/shared/format';

	interface Item {
		id: number;
		name: string;
		done: number;
		total: number;
		targetDate?: string | null;
		next?: string | null;
	}
	interface Props {
		items: Item[];
		icon: Component<{ class?: string }>;
		label: string;
		accent?: string | null;
	}
	let { items, icon: Icon, label, accent = null }: Props = $props();
	const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
</script>

<ul class="divide-y divide-border rounded-xl border border-border bg-surface" aria-label={label}>
	{#each items as item (item.id)}
		<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
			<span
				class="flex min-w-0 items-center gap-2 text-sm font-semibold max-sm:order-1 sm:w-56 sm:shrink-0"
			>
				<Icon class="size-4 shrink-0 text-muted-foreground" />
				<span class="truncate">{item.name}</span>
			</span>
			<div
				class="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted max-sm:order-3 max-sm:basis-full"
				role="progressbar"
				aria-label="{item.name} progress"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={pct(item.done, item.total)}
			>
				<div
					class="h-full rounded-full bg-primary"
					style:width="{pct(item.done, item.total)}%"
					style:background={accent ?? undefined}
				></div>
			</div>
			<span
				class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground max-sm:order-2 max-sm:basis-auto sm:max-w-[45%] sm:flex-nowrap"
			>
				<span class="shrink-0 tabular-nums">{item.done} / {item.total} done</span>
				{#if item.targetDate}<span class="shrink-0">· {formatDate(item.targetDate)}</span>{/if}
				{#if item.next}<span class="min-w-0 truncate">· next: {item.next}</span>{/if}
			</span>
		</li>
	{/each}
</ul>
