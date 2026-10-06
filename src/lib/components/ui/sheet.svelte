<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';

	interface Props {
		open?: boolean;
		title: string;
		side?: 'left' | 'right';
		class?: string;
		children?: Snippet;
	}
	let {
		open = $bindable(false),
		title,
		side = 'left',
		class: className,
		children
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class={cn(
				'fixed inset-y-0 z-50 flex w-[min(20rem,calc(100vw-3rem))] flex-col border-border bg-sidebar shadow-pop outline-none data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:duration-200',
				side === 'left'
					? 'left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left'
					: 'right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
				className
			)}
		>
			<Dialog.Title class="sr-only">{title}</Dialog.Title>
			{@render children?.()}
			<Dialog.Close
				class="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
			>
				<X class="size-4" />
				<span class="sr-only">Close menu</span>
			</Dialog.Close>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
