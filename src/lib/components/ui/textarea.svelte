<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		value = $bindable(),
		ref = $bindable(null),
		class: className,
		...rest
	}: HTMLTextareaAttributes & { ref?: HTMLTextAreaElement | null } = $props();
</script>

<textarea
	bind:this={ref}
	bind:value
	class={cn(
		'flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground shadow-card transition-colors outline-none placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
		className
	)}
	{...rest}></textarea>
