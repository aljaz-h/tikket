<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		project: { name: string; icon?: string | null; color?: string | null; logoId?: string | null };
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
		class?: string;
		/** Preview a not-yet-saved logo (e.g. a fetched website icon). */
		src?: string | null;
	}
	let { project, size = 'sm', class: className, src = null }: Props = $props();

	// One set of dimensions for every place a project is shown.
	const sizes = {
		xs: 'size-4 text-[0.5625rem] rounded',
		sm: 'size-5 text-[0.6875rem] rounded-[0.3rem]',
		md: 'size-8 text-sm rounded-md',
		lg: 'size-12 text-xl rounded-lg',
		xl: 'size-20 text-3xl rounded-xl'
	};
	const image = $derived(src ?? (project.logoId ? `/api/project-logos/${project.logoId}` : null));
	// A missing or broken image falls back to the letter/emoji without changing the layout.
	let failed = $state<string | null>(null);
</script>

{#if image && failed !== image}
	<img
		src={image}
		alt=""
		aria-hidden="true"
		loading="lazy"
		decoding="async"
		class={cn('shrink-0 bg-surface-2 object-contain', sizes[size], className)}
		onerror={() => (failed = image)}
	/>
{:else}
	<span
		aria-hidden="true"
		class={cn(
			'swatch-bg inline-flex shrink-0 items-center justify-center font-semibold select-none',
			`swatch-${project.color ?? 'indigo'}`,
			sizes[size],
			className
		)}
	>
		{project.icon || project.name.slice(0, 1).toUpperCase()}
	</span>
{/if}
