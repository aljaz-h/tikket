<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: 'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-card hover:bg-primary-hover',
				secondary: 'border border-border bg-surface-2 text-foreground hover:bg-hover',
				outline: 'border border-border bg-transparent text-foreground hover:bg-hover',
				ghost: 'text-foreground hover:bg-hover',
				subtle: 'text-muted-foreground hover:bg-hover hover:text-foreground',
				destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
				'destructive-outline':
					'border border-destructive/40 text-destructive hover:bg-destructive/10',
				link: 'h-auto px-0 text-primary underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-9 px-3.5',
				sm: 'h-8 px-2.5 text-[0.8125rem]',
				xs: 'h-7 gap-1.5 px-2 text-xs',
				lg: 'h-10 px-5',
				icon: 'size-9',
				'icon-sm': 'size-8',
				'icon-xs': 'size-7'
			}
		},
		defaultVariants: { variant: 'default', size: 'default' }
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	type Props = HTMLButtonAttributes &
		Omit<HTMLAnchorAttributes, keyof HTMLButtonAttributes | 'type'> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			href?: string;
			loading?: boolean;
			ref?: HTMLElement | null;
		};

	let {
		class: className,
		variant = 'default',
		size = 'default',
		href = undefined,
		type = 'button',
		loading = false,
		disabled,
		ref = $bindable(null),
		children,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		{href}
		class={cn(buttonVariants({ variant, size }), className)}
		aria-disabled={disabled || undefined}
		{...rest as HTMLAnchorAttributes}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		{type}
		class={cn(buttonVariants({ variant, size }), className)}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...rest}
	>
		{#if loading}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
		{@render children?.()}
	</button>
{/if}
