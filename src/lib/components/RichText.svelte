<script lang="ts">
	import { cn } from '$lib/utils';
	/** Renders HTML that was sanitised on the server with the rich-text allow-list. */
	let { html, class: className }: { html: string; class?: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class={cn('rich-text', className)}>{@html html}</div>
