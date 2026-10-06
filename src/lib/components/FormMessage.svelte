<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { cn } from '$lib/utils';

	let {
		message,
		variant = 'error',
		class: className
	}: { message?: string | null; variant?: 'error' | 'success' | 'info'; class?: string } = $props();
</script>

{#if message}
	<div
		role={variant === 'error' ? 'alert' : 'status'}
		class={cn(
			'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
			variant === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
			variant === 'success' && 'tone tone-completed',
			variant === 'info' && 'border-border bg-muted text-muted-foreground',
			className
		)}
	>
		{#if variant === 'error'}<CircleAlert class="mt-0.5 size-4 shrink-0" />{:else}<CircleCheck
				class="mt-0.5 size-4 shrink-0"
			/>{/if}
		<span>{message}</span>
	</div>
{/if}
