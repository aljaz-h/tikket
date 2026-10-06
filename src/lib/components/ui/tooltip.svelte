<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		disabled?: boolean;
		children: Snippet<[{ props: Record<string, unknown> }]>;
	}
	let { text, side = 'top', disabled = false, children }: Props = $props();
</script>

<Tooltip.Root delayDuration={250} disabled={disabled}>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			{@render children({ props })}
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Portal>
		<Tooltip.Content
			{side}
			sideOffset={6}
			class="z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-pop data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
		>
			{text}
		</Tooltip.Content>
	</Tooltip.Portal>
</Tooltip.Root>
