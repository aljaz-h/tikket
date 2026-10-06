<script lang="ts">
	import { STATUS_META, type TicketStatus } from '$lib/shared/constants';
	import { cn } from '$lib/utils';
	import { STATUS_ICONS } from './icons';

	let {
		status,
		class: className,
		iconOnly = false
	}: { status: TicketStatus; class?: string; iconOnly?: boolean } = $props();
	const meta = $derived(STATUS_META[status]);
	const Icon = $derived(STATUS_ICONS[status]);
</script>

{#if iconOnly}
	<span class={cn('tone-text inline-flex', meta.tone, className)} title={meta.label}>
		<Icon class="size-4" aria-hidden="true" />
		<span class="sr-only">{meta.label}</span>
	</span>
{:else}
	<span
		class={cn(
			'tone inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
			meta.tone,
			className
		)}
	>
		<Icon class="size-3.5" aria-hidden="true" />
		{meta.label}
	</span>
{/if}
