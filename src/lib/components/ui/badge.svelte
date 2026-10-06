<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	let {
		class: className,
		variant = 'outline',
		children,
		...rest
	}: HTMLAttributes<HTMLSpanElement> & {
		variant?: 'outline' | 'tone' | 'solid' | 'muted';
	} = $props();
</script>

<span
	class={cn(
		'inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
		variant === 'outline' && 'border-border text-muted-foreground',
		variant === 'tone' && 'tone',
		variant === 'solid' && 'border-transparent bg-primary text-primary-foreground',
		variant === 'muted' && 'border-transparent bg-muted text-muted-foreground',
		className
	)}
	{...rest}
>
	{@render children?.()}
</span>
