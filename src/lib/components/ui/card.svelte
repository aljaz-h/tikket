<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...rest}>
	{@render children?.()}
</div>
