<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		tabs: { href: string; label: string; active: boolean }[];
		label: string;
		class?: string;
	}
	let { tabs, label, class: className }: Props = $props();
</script>

<!--
	Underlined tab row. The active underline is drawn inside each tab (no negative margins), so
	the row never overflows vertically; when tabs don't fit they scroll sideways without a
	visible scrollbar and remain reachable by swipe and keyboard (focus scrolls them into view).
-->
<nav
	class={cn(
		'scroll-quiet -mx-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-4 sm:mx-0 sm:px-0',
		className
	)}
	aria-label={label}
>
	{#each tabs as tab (tab.href)}
		<a
			href={tab.href}
			aria-current={tab.active ? 'page' : undefined}
			class={cn(
				'shrink-0 rounded-t-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
				tab.active
					? 'font-medium text-foreground shadow-[inset_0_-2px_0_var(--primary-border)]'
					: 'text-muted-foreground hover:text-foreground'
			)}>{tab.label}</a
		>
	{/each}
</nav>
