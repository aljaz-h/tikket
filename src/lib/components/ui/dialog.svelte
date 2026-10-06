<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		class?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		children?: Snippet;
		footer?: Snippet;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(false),
		title,
		description,
		class: className,
		size = 'md',
		children,
		footer,
		onOpenChange
	}: Props = $props();
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class={cn(
				'fixed top-[50%] left-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-xl border border-border bg-popover p-5 shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]',
				size === 'sm' && 'max-w-sm',
				size === 'md' && 'max-w-lg',
				size === 'lg' && 'max-w-2xl',
				size === 'xl' && 'max-w-4xl',
				className
			)}
		>
			<div class="grid gap-1 pr-8">
				<Dialog.Title class="text-base font-semibold tracking-tight">{title}</Dialog.Title>
				{#if description}
					<Dialog.Description class="text-sm text-muted-foreground"
						>{description}</Dialog.Description
					>
				{/if}
			</div>
			{@render children?.()}
			{#if footer}
				<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{@render footer()}</div>
			{/if}
			<Dialog.Close
				class="absolute top-3.5 right-3.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
			>
				<X class="size-4" />
				<span class="sr-only">Close</span>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
