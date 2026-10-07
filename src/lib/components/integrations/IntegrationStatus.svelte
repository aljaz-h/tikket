<script lang="ts">
	import { cn } from '$lib/utils';

	/** Compact health indicator shared by all integration pages. */
	let {
		state,
		label,
		class: className
	}: { state: 'ok' | 'warn' | 'error' | 'off'; label: string; class?: string } = $props();
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
		state === 'ok' && 'border-success/30 bg-success/10 text-success',
		state === 'warn' && 'border-warning/40 bg-warning/10 text-warning',
		state === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
		state === 'off' && 'border-border bg-muted text-muted-foreground',
		className
	)}
>
	<span
		class={cn(
			'size-1.5 rounded-full',
			state === 'ok' && 'bg-success',
			state === 'warn' && 'bg-warning',
			state === 'error' && 'bg-destructive',
			state === 'off' && 'bg-muted-foreground/60'
		)}
		aria-hidden="true"
	></span>
	{label}
</span>
