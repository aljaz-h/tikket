<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { cn } from '$lib/utils';
	import { menuItemClass } from './menu-styles';

	let {
		class: className,
		destructive = false,
		children,
		...rest
	}: DropdownMenu.ItemProps & { destructive?: boolean } = $props();
</script>

<DropdownMenu.Item
	class={cn(menuItemClass, destructive && 'text-destructive [&_svg]:text-destructive', className)}
	{...rest}
>
	{@render children?.()}
</DropdownMenu.Item>
