<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		class: className,
		sideOffset = 6,
		align = 'start',
		children,
		...rest
	}: DropdownMenu.ContentProps = $props();
</script>

<DropdownMenu.Portal>
	<DropdownMenu.Content
		{sideOffset}
		{align}
		class={cn(
			'z-50 max-h-[var(--bits-dropdown-menu-content-available-height)] min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
			className
		)}
		{...rest}
	>
		{@render children?.()}
	</DropdownMenu.Content>
</DropdownMenu.Portal>
