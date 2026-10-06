<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import TicketRow from './TicketRow.svelte';
	import { cn } from '$lib/utils';

	type Ticket = ComponentProps<typeof TicketRow>['ticket'];
	interface Props {
		tickets: Ticket[];
		showProject?: boolean;
		label?: string;
		class?: string;
		/** Ticket numbers selected for bulk editing; enables selection when bound. */
		selected?: number[];
	}
	let {
		tickets,
		showProject = false,
		label = 'Tickets',
		class: className,
		selected = $bindable()
	}: Props = $props();

	function toggle(number: number, on: boolean) {
		if (!selected) return;
		selected = on ? [...new Set([...selected, number])] : selected.filter((n) => n !== number);
	}
</script>

<ul
	class={cn(
		'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface',
		className
	)}
	aria-label={label}
>
	{#each tickets as ticket (`${ticket.projectKey}-${ticket.number}`)}
		<TicketRow
			{ticket}
			{showProject}
			selected={selected ? selected.includes(ticket.number) : undefined}
			onselect={(on) => toggle(ticket.number, on)}
		/>
	{/each}
</ul>
