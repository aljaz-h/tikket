<script lang="ts">
	import { Popover } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		class: className,
		sideOffset = 6,
		align = 'start',
		children,
		...rest
	}: Popover.ContentProps = $props();
</script>

<Popover.Portal>
	<Popover.Content
		{sideOffset}
		{align}
		class={cn(
			'z-50 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-sm shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
			className
		)}
		{...rest}
	>
		{@render children?.()}
	</Popover.Content>
</Popover.Portal>
