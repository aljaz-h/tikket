<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { cn } from '$lib/utils';
	import { menuContentClass } from './menu-styles';

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
			menuContentClass,
			'max-h-[var(--bits-dropdown-menu-content-available-height)]',
			className
		)}
		{...rest}
	>
		{@render children?.()}
	</DropdownMenu.Content>
</DropdownMenu.Portal>
