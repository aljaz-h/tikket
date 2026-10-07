<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		checked = $bindable(false),
		group = $bindable(),
		indeterminate = $bindable(false),
		class: className,
		onchange,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { group?: unknown[] } = $props();

	// Svelte's bind:group only sees inputs of the same component instance, so each Checkbox would
	// replace the whole array with its own value. Group membership is handled per value instead.
	const inGroup = $derived(group !== undefined && group.includes(rest.value));
</script>

{#if group !== undefined}
	<input
		type="checkbox"
		checked={inGroup}
		bind:indeterminate
		class={cn('size-4 shrink-0', className)}
		onchange={(e) => {
			const on = e.currentTarget.checked;
			const current: unknown[] = group ?? [];
			group = on
				? current.includes(rest.value)
					? current
					: [...current, rest.value]
				: current.filter((v) => v !== rest.value);
			onchange?.(e);
		}}
		{...rest}
	/>
{:else}
	<input
		type="checkbox"
		bind:checked
		bind:indeterminate
		class={cn('size-4 shrink-0', className)}
		{onchange}
		{...rest}
	/>
{/if}
