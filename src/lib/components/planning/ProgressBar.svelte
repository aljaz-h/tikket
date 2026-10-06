<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		progress: { total: number; completed: number; percent: number | null };
		label: string;
		class?: string;
		compact?: boolean;
	}
	let { progress, label, class: className, compact = false }: Props = $props();
</script>

<!-- No tickets → no bar: an empty 0 % would suggest work that doesn't exist. -->
<div class={cn('grid gap-1.5', className)}>
	{#if progress.total}
		<div
			class={cn('overflow-hidden rounded-full bg-muted', compact ? 'h-1.5' : 'h-2')}
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={progress.total}
			aria-valuenow={progress.completed}
			aria-valuetext="{progress.completed} of {progress.total} tickets completed"
		>
			<div
				class="h-full rounded-full bg-primary transition-[width]"
				style="width: {progress.percent ?? 0}%"
			></div>
		</div>
		<p class="text-xs text-muted-foreground tabular-nums">
			{progress.completed} of {progress.total} ticket{progress.total === 1 ? '' : 's'} completed
			{#if !compact}· {progress.percent}%{/if}
		</p>
	{:else}
		<p class="text-xs text-muted-foreground">No tickets assigned yet</p>
	{/if}
</div>
