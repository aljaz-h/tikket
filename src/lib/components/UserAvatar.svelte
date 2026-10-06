<script lang="ts">
	import { initials } from '$lib/shared/text';
	import { cn } from '$lib/utils';

	interface Props {
		user: { displayName: string; avatarId?: string | null } | null | undefined;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
		class?: string;
	}
	let { user, size = 'sm', class: className }: Props = $props();

	const sizes = {
		xs: 'size-5 text-[0.5625rem]',
		sm: 'size-6 text-[0.625rem]',
		md: 'size-8 text-xs',
		lg: 'size-10 text-sm',
		xl: 'size-20 text-xl'
	};
	// A stable hue per name keeps fallback avatars distinguishable.
	const hue = $derived(
		[...(user?.displayName ?? '?')].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 360, 7)
	);
</script>

{#if user?.avatarId}
	<img
		src="/api/avatars/{user.avatarId}"
		alt=""
		loading="lazy"
		class={cn('shrink-0 rounded-full bg-muted object-cover', sizes[size], className)}
	/>
{:else}
	<span
		aria-hidden="true"
		style="background-color: oklch(0.55 0.09 {hue} / 0.28); color: oklch(0.8 0.1 {hue});"
		class={cn(
			'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
			sizes[size],
			className
		)}>{initials(user?.displayName ?? '?')}</span
	>
{/if}
