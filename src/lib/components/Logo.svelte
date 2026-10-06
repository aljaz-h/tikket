<script lang="ts" module>
	/** Ticket silhouette, text lines and checkmark of the Tikket icon (256 × 256 artboard). */
	export const ICON_PATH =
		'M42 35 H214 Q229 35 229 50 V92 C214 92 202 104 202 119 S214 146 229 146 V206 Q229 221 214 221 H42 Q27 221 27 206 V146 C42 146 54 134 54 119 S42 92 27 92 V50 Q27 35 42 35 Z';
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		/** Workspace name. The default "Tikket" renders the official wordmark. */
		name?: string;
		showName?: boolean;
		size?: 'sm' | 'md' | 'lg';
	}
	let { class: className, name = 'Tikket', showName = true, size = 'md' }: Props = $props();

	// Unique per instance: several logos can be on one page and SVG ids are document-global.
	const uid = $props.id();
	const gradient = `tikket-gradient-${uid}`;
	const wordmark = $derived(showName && name.trim() === 'Tikket');
	const iconSize = $derived(size === 'sm' ? 'size-5' : size === 'lg' ? 'size-9' : 'size-7');
	const wordmarkHeight = $derived(size === 'sm' ? 'h-5' : size === 'lg' ? 'h-9' : 'h-7');
</script>

{#snippet icon()}
	<defs>
		<linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
			<stop offset="0" stop-color="#83ef8b" />
			<stop offset="1" stop-color="#c6ff5e" />
		</linearGradient>
	</defs>
	<path fill="url(#{gradient})" fill-rule="evenodd" d={ICON_PATH} />
	<g fill="none" stroke="#14201c" stroke-linecap="round" stroke-linejoin="round">
		<path d="M84 87 L157 78" stroke-width="17" />
		<path d="M84 122 L127 116" stroke-width="17" />
		<path d="M132 163 L151 181 L186 140" stroke-width="18" />
	</g>
{/snippet}

{#if wordmark}
	<!-- Official logo: icon + wordmark in the original 840 × 220 proportions; text follows the theme. -->
	<svg
		viewBox="0 0 840 220"
		class={cn('w-auto shrink-0 text-foreground', wordmarkHeight, className)}
		role="img"
		aria-label="Tikket"
	>
		<g transform="translate(7 7) scale(.805)">{@render icon()}</g>
		<text
			x="228"
			y="157"
			fill="currentColor"
			font-family="Inter, 'Inter Variable', Arial, Helvetica, sans-serif"
			font-size="139"
			font-weight="800"
			letter-spacing="-6">Tikket</text
		>
	</svg>
{:else}
	<span
		class={cn(
			'inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight',
			size === 'lg' && 'gap-2.5 text-lg',
			className
		)}
	>
		<svg viewBox="0 0 256 256" class={cn('shrink-0', iconSize)} aria-hidden="true">
			{@render icon()}
		</svg>
		{#if showName}<span class="truncate">{name}</span>{/if}
	</span>
{/if}
