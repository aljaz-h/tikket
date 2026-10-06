<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { ContextMenu } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Hash from '@lucide/svelte/icons/hash';
	import SquareArrowRight from '@lucide/svelte/icons/square-arrow-right';
	import { menuContentClass, menuItemClass } from './ui/menu-styles';

	interface Props {
		/** Ticket URL (may carry list context for previous/next). */
		href: string;
		/** Human reference, e.g. SPL-12. */
		reference: string;
		/** The element that opens the menu on right-click / the context-menu key. */
		children: Snippet<[{ props: Record<string, unknown> }]>;
	}
	let { href, reference, children }: Props = $props();

	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${what} copied`);
		} catch {
			toast.error('Could not copy to the clipboard');
		}
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger>
		{#snippet child({ props })}{@render children({ props })}{/snippet}
	</ContextMenu.Trigger>
	<ContextMenu.Portal>
		<ContextMenu.Content class={menuContentClass}>
			<ContextMenu.Item class={menuItemClass} onSelect={() => goto(href)}
				><SquareArrowRight /> Open {reference}</ContextMenu.Item
			>
			<ContextMenu.Item
				class={menuItemClass}
				onSelect={() => window.open(href, '_blank', 'noopener')}
				><ExternalLink /> Open in new tab</ContextMenu.Item
			>
			<ContextMenu.Separator class="-mx-1 my-1 h-px bg-border" />
			<ContextMenu.Item
				class={menuItemClass}
				onSelect={() => copy(new URL(href.split('?')[0], location.origin).href, 'Link')}
				><Link2 /> Copy link</ContextMenu.Item
			>
			<ContextMenu.Item class={menuItemClass} onSelect={() => copy(reference, 'Reference')}
				><Hash /> Copy reference</ContextMenu.Item
			>
		</ContextMenu.Content>
	</ContextMenu.Portal>
</ContextMenu.Root>
