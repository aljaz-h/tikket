<script lang="ts">
	import { cn } from '$lib/utils';
	let { class: className, name = 'Tikket', showName = true }: { class?: string; name?: string; showName?: boolean } = $props();
</script>

<span class={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
	<svg viewBox="0 0 32 32" class="size-6 shrink-0" aria-hidden="true">
		<rect width="32" height="32" rx="8" fill="var(--primary)" />
		<path d="M9 11.5h14M16 11.5V23" stroke="var(--primary-foreground)" stroke-width="3.2" stroke-linecap="round" />
		<circle cx="23" cy="21.5" r="2.2" fill="var(--primary-foreground)" />
	</svg>
	{#if showName}<span class="truncate">{name}</span>{/if}
</span>
