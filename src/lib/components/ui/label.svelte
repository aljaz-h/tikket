<script lang="ts">
	import type { HTMLLabelAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: HTMLLabelAttributes = $props();
</script>

<label class={cn('text-[0.8125rem] leading-none font-medium text-foreground', className)} {...rest}>
	{@render children?.()}
</label>
