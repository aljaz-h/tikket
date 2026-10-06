<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import Monitor from '@lucide/svelte/icons/monitor';
	import type { Theme } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	let { current }: { current: Theme } = $props();
	let theme = $state<Theme>('dark');
	$effect.pre(() => {
		theme = current;
	});

	const options: { value: Theme; label: string; icon: typeof Moon }[] = [
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'system', label: 'System', icon: Monitor }
	];

	function apply(next: Theme) {
		theme = next;
		const root = document.documentElement;
		root.classList.remove('dark', 'light', 'theme-system');
		root.classList.add(next === 'system' ? 'theme-system' : next);
	}
</script>

<form
	method="POST"
	action="/theme"
	class="flex rounded-md border border-border p-0.5"
	aria-label="Theme"
	use:enhance={({ formData }) => {
		apply(formData.get('theme') as Theme);
		return async () => {};
	}}
>
	<input type="hidden" name="redirectTo" value={page.url.pathname + page.url.search} />
	{#each options as option (option.value)}
		{@const Icon = option.icon}
		<button
			type="submit"
			name="theme"
			value={option.value}
			aria-pressed={theme === option.value}
			title={option.label}
			class={cn(
				'inline-flex h-6 flex-1 items-center justify-center rounded px-2 text-muted-foreground transition-colors hover:text-foreground',
				theme === option.value && 'bg-hover text-foreground'
			)}
		>
			<Icon class="size-3.5" />
			<span class="sr-only">{option.label} theme</span>
		</button>
	{/each}
</form>
