<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		project: { name: string; icon?: string | null; color?: string | null };
		size?: 'xs' | 'sm' | 'md' | 'lg';
		class?: string;
	}
	let { project, size = 'sm', class: className }: Props = $props();
	const sizes = {
		xs: 'size-4 text-[0.5625rem] rounded',
		sm: 'size-5 text-[0.6875rem] rounded-[0.3rem]',
		md: 'size-8 text-sm rounded-md',
		lg: 'size-12 text-xl rounded-lg'
	};
</script>

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
