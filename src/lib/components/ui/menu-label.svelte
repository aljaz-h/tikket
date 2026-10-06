<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<DropdownMenu.GroupHeading class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
	{@render children()}
</DropdownMenu.GroupHeading>
