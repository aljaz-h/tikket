<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		class: className,
		destructive = false,
		children,
		...rest
	}: DropdownMenu.ItemProps & { destructive?: boolean } = $props();
</script>

<DropdownMenu.Item
	class={cn(
		'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted-foreground',
		destructive && 'text-destructive [&_svg]:text-destructive',
		className
	)}
	{...rest}
>
	{@render children?.()}
</DropdownMenu.Item>
