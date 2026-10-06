<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		icon?: Component<{ class?: string }>;
		title: string;
		description?: string;
		class?: string;
		children?: Snippet;
	}
	let { icon: Icon, title, description, class: className, children }: Props = $props();
</script>

<div
	class={cn(
		'flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center',
		className
	)}
>
	{#if Icon}
		<div
			class="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
		>
			<Icon class="size-5" />
		</div>
	{/if}
	<h3 class="text-sm font-semibold">{title}</h3>
	{#if description}<p class="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{/if}
	{#if children}<div class="mt-4 flex flex-wrap justify-center gap-2">
			{@render children()}
		</div>{/if}
</div>
