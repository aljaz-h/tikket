<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		value = $bindable(),
		ref = $bindable(null),
		class: className,
		...rest
	}: HTMLInputAttributes & { ref?: HTMLInputElement | null } = $props();
</script>

<input
	bind:this={ref}
	bind:value
	class={cn(
		'flex h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground shadow-card transition-colors outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-subtle-foreground focus-visible:border-primary-border focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/25',
		className
	)}
	{...rest}
/>
