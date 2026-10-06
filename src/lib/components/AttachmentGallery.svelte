<script lang="ts">
	import { Dialog } from 'bits-ui';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { formatBytes } from '$lib/shared/text';
	import { cn } from '$lib/utils';

	interface Item {
		id: string;
		originalName: string;
		size: number;
		width: number | null;
		height: number | null;
		hasThumbnail: boolean;
	}
	interface Props {
		items: Item[];
		size?: 'md' | 'sm';
		removeControl?: Snippet<[Item]>;
	}
	let { items, size = 'md', removeControl }: Props = $props();

	let open = $state(false);
	let index = $state(0);
	const current = $derived(items[index]);

	function show(i: number, e: MouseEvent) {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		index = i;
		open = true;
	}
	function step(delta: number) {
		index = (index + delta + items.length) % items.length;
	}
</script>

{#if items.length}
	<ul
		class={cn(
			'grid gap-2',
			size === 'md' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5'
		)}
	>
		{#each items as item, i (item.id)}
			<li class="group relative">
				<a
					href="/api/files/{item.id}"
					class="block overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring"
					onclick={(e) => show(i, e)}
					aria-label="View {item.originalName}"
				>
					<img
						src="/api/files/{item.id}{item.hasThumbnail ? '?thumb=1' : ''}"
						alt={item.originalName}
						loading="lazy"
						decoding="async"
						width={item.width ?? undefined}
						height={item.height ?? undefined}
						class={cn('w-full object-cover', size === 'md' ? 'aspect-[16/10]' : 'aspect-[4/3]')}
					/>
				</a>
				<div class="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
					<span class="truncate" title={item.originalName}>{item.originalName}</span>
					{#if removeControl}{@render removeControl(item)}{/if}
				</div>
			</li>
		{/each}
	</ul>

	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
			<Dialog.Content
				class="fixed inset-0 z-50 flex flex-col outline-none"
				onkeydown={(e) => {
					if (e.key === 'ArrowRight') step(1);
					if (e.key === 'ArrowLeft') step(-1);
				}}
			>
				{#if current}
					<div class="flex items-center justify-between gap-3 px-4 py-3 text-white">
						<div class="min-w-0">
							<Dialog.Title class="truncate text-sm font-medium">{current.originalName}</Dialog.Title>
							<Dialog.Description class="text-xs text-white/60">
								{index + 1} of {items.length}
								{#if current.width}· {current.width}×{current.height}{/if} · {formatBytes(current.size)}
							</Dialog.Description>
						</div>
						<div class="flex items-center gap-1">
							<a
								href="/api/files/{current.id}?download=1"
								class="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
								aria-label="Download"
							>
								<Download class="size-4" />
							</a>
							<Dialog.Close
								class="inline-flex size-9 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
							>
								<X class="size-5" /><span class="sr-only">Close</span>
							</Dialog.Close>
						</div>
					</div>
					<div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
						<img src="/api/files/{current.id}" alt={current.originalName} class="max-h-full max-w-full rounded object-contain" />
						{#if items.length > 1}
							<button
								type="button"
								class="absolute left-2 inline-flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 sm:left-4"
								onclick={() => step(-1)}
								aria-label="Previous image"><ChevronLeft class="size-5" /></button
							>
							<button
								type="button"
								class="absolute right-2 inline-flex size-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 sm:right-4"
								onclick={() => step(1)}
								aria-label="Next image"><ChevronRight class="size-5" /></button
							>
						{/if}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}
