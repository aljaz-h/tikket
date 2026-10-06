<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		checked = $bindable(false),
		group = $bindable(),
		indeterminate = $bindable(false),
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { group?: unknown[] } = $props();
</script>

{#if group !== undefined}
	<input
		type="checkbox"
		bind:group
		bind:indeterminate
		class={cn('size-4 shrink-0', className)}
		{...rest}
	/>
{:else}
	<input
		type="checkbox"
		bind:checked
		bind:indeterminate
		class={cn('size-4 shrink-0', className)}
		{...rest}
	/>
{/if}
