<script lang="ts">
	import { linkify } from '$lib/shared/text';
	let { text, class: className }: { text: string; class?: string } = $props();
	const segments = $derived(linkify(text));
</script>

<p class={['[overflow-wrap:anywhere] whitespace-pre-wrap', className]}>
	{#each segments as seg, i (i)}{#if seg.type === 'link'}<a
				href={seg.href}
				target="_blank"
				rel="noopener noreferrer nofollow ugc"
				class="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
				>{seg.value}</a
			>{:else}{seg.value}{/if}{/each}
</p>
