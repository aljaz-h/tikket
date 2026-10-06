<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let {
		value = $bindable(),
		ref = $bindable(null),
		class: className,
		children,
		...rest
	}: HTMLSelectAttributes & { ref?: HTMLSelectElement | null } = $props();
</script>

<div class={cn('relative', className)}>
	<select
		bind:this={ref}
		bind:value
		class="h-9 w-full appearance-none rounded-md border border-input bg-surface py-1 pr-8 pl-3 text-sm text-foreground shadow-card transition-colors outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
		{...rest}
	>
		{@render children?.()}
	</select>
	<ChevronDown
		class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
		aria-hidden="true"
	/>
</div>
