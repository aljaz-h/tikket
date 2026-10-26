<script lang="ts">
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		tabs: { href: string; label: string; active: boolean }[];
		label: string;
		class?: string;
	}
	let { tabs, label, class: className }: Props = $props();

	let row: HTMLDivElement | undefined = $state();
	// Position of the active tab; null until measured (and without JavaScript), when each tab
	// draws its own underline instead.
	let bar = $state<{ x: number; width: number } | null>(null);
	let animate = $state(false);

	function measure() {
		const active = row?.querySelector<HTMLElement>('a[aria-current="page"]');
		bar = active ? { x: active.offsetLeft, width: active.offsetWidth } : null;
	}
	$effect(() => {
		// Re-measure whenever the tabs or the active one change.
		void tabs.map((t) => `${t.href}${t.active}${t.label}`).join();
		measure();
	});
	onMount(() => {
		measure();
		const observer = new ResizeObserver(measure);
		if (row) observer.observe(row);
		// Only slide after the first paint, so the bar never animates in from the left.
		const frame = requestAnimationFrame(() => (animate = true));
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});
</script>

<!--
	Underlined tab row. A single bar slides to the active tab; it is drawn inside the scrolling
	row (no negative margins), so the row never overflows vertically. When tabs don't fit they
	scroll sideways without a visible scrollbar and remain reachable by swipe and keyboard
	(focus scrolls them into view). Without JavaScript each active tab underlines itself.
-->
<nav
	class={cn(
		'scroll-quiet -mx-4 overflow-x-auto overflow-y-hidden border-b border-border px-4 sm:mx-0 sm:px-0',
		className
	)}
	aria-label={label}
>
	<div class="relative flex w-max min-w-full gap-1" bind:this={row}>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={tab.active ? 'page' : undefined}
				class={cn(
					'shrink-0 rounded-t-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
					tab.active
						? cn(
								'font-medium text-foreground',
								!bar && 'shadow-[inset_0_-2px_0_var(--primary-border)]'
							)
						: 'text-muted-foreground hover:text-foreground'
				)}>{tab.label}</a
			>
		{/each}
		{#if bar}
			<span
				aria-hidden="true"
				class={cn(
					'pointer-events-none absolute bottom-0 left-0 h-0.5 bg-primary-border',
					animate &&
						'transition-[transform,width] duration-200 ease-out motion-reduce:transition-none'
				)}
				style:width="{bar.width}px"
				style:transform="translateX({bar.x}px)"
			></span>
		{/if}
	</div>
</nav>
