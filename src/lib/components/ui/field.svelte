<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import Label from './label.svelte';

	interface Props {
		label?: string;
		for?: string;
		hint?: string;
		error?: string | null;
		optional?: boolean;
		required?: boolean;
		class?: string;
		children: Snippet;
	}

	let { label, for: htmlFor, hint, error, optional, required, class: className, children }: Props =
		$props();
</script>

<div class={cn('grid gap-1.5', className)}>
	{#if label}
		<Label for={htmlFor} class="flex items-center gap-1.5">
			{label}
			{#if required}<span class="text-destructive" aria-hidden="true">*</span>{/if}
			{#if optional}<span class="text-xs font-normal text-subtle-foreground">Optional</span>{/if}
		</Label>
	{/if}
	{@render children()}
	{#if error}
		<p class="text-xs text-destructive" id={htmlFor ? `${htmlFor}-error` : undefined} role="alert">
			{error}
		</p>
	{:else if hint}
		<p class="text-xs text-muted-foreground" id={htmlFor ? `${htmlFor}-hint` : undefined}>{hint}</p>
	{/if}
</div>
