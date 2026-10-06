<script lang="ts">
	import { page } from '$app/state';
	import { projectPath } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { children, data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings'));
	const tabs = $derived([
		{ href: base, label: 'General', exact: true },
		{ href: `${base}/widget`, label: 'Feedback widget' },
		{ href: `${base}/templates`, label: 'Ticket templates' }
	]);
	const active = (t: { href: string; exact?: boolean }) =>
		t.exact ? page.url.pathname === t.href : page.url.pathname.startsWith(t.href);
</script>

<div class="grid gap-6">
	<nav
		class="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 sm:w-fit"
		aria-label="Settings sections"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				aria-current={active(tab) ? 'page' : undefined}
				class={cn(
					'rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
					active(tab)
						? 'bg-hover font-medium text-foreground'
						: 'text-muted-foreground hover:text-foreground'
				)}>{tab.label}</a
			>
		{/each}
	</nav>
	{@render children()}
</div>
