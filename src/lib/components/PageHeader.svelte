<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		description?: string | null;
		class?: string;
		eyebrow?: Snippet;
		actions?: Snippet;
	}
	let { title, description, class: className, eyebrow, actions }: Props = $props();
</script>

<header class={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
	<div class="min-w-0">
		{#if eyebrow}<div class="mb-1.5 text-sm text-muted-foreground">{@render eyebrow()}</div>{/if}
		<h1 class="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
		{#if description}<p class="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>{/if}
	</div>
	{#if actions}<div class="flex shrink-0 flex-wrap items-center gap-2">
			{@render actions()}
		</div>{/if}
</header>
