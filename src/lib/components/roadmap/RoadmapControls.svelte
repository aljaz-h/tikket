<script lang="ts">
	import Select from '../ui/select.svelte';
	import { TICKET_TYPES, TYPE_META, type TicketType } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	export type RoadmapGroup = 'status' | 'milestone' | 'month';
	export type RoadmapViewMode = 'board' | 'timeline';

	interface Props {
		type: TicketType | null;
		group: RoadmapGroup;
		view: RoadmapViewMode;
		onchange: (patch: {
			type?: TicketType | null;
			group?: RoadmapGroup;
			view?: RoadmapViewMode;
		}) => void;
	}
	let { type, group, view, onchange }: Props = $props();

	const chip =
		'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors pointer-coarse:h-11 pointer-coarse:px-4';
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<div class="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
		<button
			type="button"
			aria-pressed={type === null}
			onclick={() => onchange({ type: null })}
			class={cn(
				chip,
				type === null
					? 'border-primary-border bg-primary-soft font-medium text-foreground'
					: 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground'
			)}>All</button
		>
		{#each TICKET_TYPES as t (t)}
			<button
				type="button"
				aria-pressed={type === t}
				onclick={() => onchange({ type: type === t ? null : t })}
				class={cn(
					chip,
					type === t
						? 'border-primary-border bg-primary-soft font-medium text-foreground'
						: 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground'
				)}>{TYPE_META[t].short}</button
			>
		{/each}
	</div>
	<div class="flex flex-wrap items-center gap-3">
		{#if view === 'board'}
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground" id="roadmap-group-label">Group by</span>
				<Select
					value={group}
					aria-label="Group by"
					class="w-36"
					onchange={(v) => onchange({ group: v as RoadmapGroup })}
					items={[
						{ value: 'status', label: 'Status' },
						{ value: 'milestone', label: 'Milestone' },
						{ value: 'month', label: 'Month' }
					]}
				/>
			</div>
		{/if}
		<div class="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="View">
			{#each [{ id: 'board', label: 'Board' }, { id: 'timeline', label: 'Timeline' }] as v (v.id)}
				<button
					type="button"
					aria-pressed={view === v.id}
					onclick={() => onchange({ view: v.id as RoadmapViewMode })}
					class={cn(
						'h-7 rounded-md px-3 text-sm transition-colors pointer-coarse:h-10 pointer-coarse:px-4',
						view === v.id
							? 'bg-hover font-medium text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}>{v.label}</button
				>
			{/each}
		</div>
	</div>
</div>
