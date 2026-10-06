<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	let { class: className, children }: { class?: string; children: Snippet } = $props();
</script>

<kbd
	class={cn(
		'pointer-events-none inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-sans text-[0.6875rem] font-medium text-muted-foreground select-none',
		className
	)}>{@render children()}</kbd
>
