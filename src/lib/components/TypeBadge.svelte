<script lang="ts">
	import { TYPE_META, type TicketType } from '$lib/shared/constants';
	import { cn } from '$lib/utils';
	import { TYPE_ICONS, TYPE_TONES } from './icons';

	let {
		type,
		class: className,
		iconOnly = false,
		short = true
	}: { type: TicketType; class?: string; iconOnly?: boolean; short?: boolean } = $props();
	const meta = $derived(TYPE_META[type]);
	const Icon = $derived(TYPE_ICONS[type]);
</script>

<span
	class={cn(
		'tone-text inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
		TYPE_TONES[type],
		className
	)}
	title={iconOnly ? meta.label : undefined}
>
	<Icon class="size-3.5" aria-hidden="true" />
	{#if iconOnly}<span class="sr-only">{meta.label}</span>{:else}{short
			? meta.short
			: meta.label}{/if}
</span>
