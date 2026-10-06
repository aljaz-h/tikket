/** Shared look of dropdown and context menus. */
export const menuContentClass =
	'z-50 min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]';

export const menuItemClass =
	'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted-foreground data-[highlighted]:[&_svg]:text-foreground';
