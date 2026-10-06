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
	}
	let { tickets, showProject = false, label = 'Tickets', class: className }: Props = $props();
</script>

<ul
	class={cn(
		'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface',
		className
	)}
	aria-label={label}
>
	{#each tickets as ticket (`${ticket.projectKey}-${ticket.number}`)}
		<TicketRow {ticket} {showProject} />
	{/each}
</ul>
