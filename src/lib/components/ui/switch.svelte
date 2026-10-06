<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		checked = $bindable(false),
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> = $props();
</script>

<!-- A native checkbox styled as a switch: works in plain HTML forms without JavaScript. -->
<input
	type="checkbox"
	role="switch"
	bind:checked
	class={cn(
		'relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full border border-border-strong bg-muted transition-colors outline-none',
		"before:absolute before:top-0.5 before:left-0.5 before:size-3.5 before:rounded-full before:bg-muted-foreground before:transition-transform before:content-['']",
		'checked:border-primary-border checked:bg-primary checked:before:translate-x-4 checked:before:bg-primary-foreground',
		'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...rest}
/>
