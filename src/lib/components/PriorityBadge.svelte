<script lang="ts">
	import { PRIORITY_META, type TicketPriority } from '$lib/shared/constants';
	import { cn } from '$lib/utils';
	import { PRIORITY_ICONS } from './icons';

	let {
		priority,
		class: className,
		iconOnly = false
	}: { priority: TicketPriority; class?: string; iconOnly?: boolean } = $props();
	const meta = $derived(PRIORITY_META[priority]);
	const Icon = $derived(PRIORITY_ICONS[priority]);
</script>

<span
	class={cn('tone-text inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap', meta.tone, className)}
	title={iconOnly ? `${meta.label} priority` : undefined}
>
	<Icon class="size-3.5" aria-hidden="true" />
	{#if iconOnly}<span class="sr-only">{meta.label} priority</span>{:else}{meta.label}{/if}
</span>
