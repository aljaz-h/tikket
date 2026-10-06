<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { cn } from '$lib/utils';
	let { children } = $props();
	const tabs = [
		{ href: '/settings/profile', label: 'Profile' },
		{ href: '/settings/security', label: 'Password & sessions' },
		{ href: '/settings/notifications', label: 'Notifications' }
	];
</script>

<div class="mx-auto grid max-w-3xl gap-6">
	<PageHeader title="Account settings" />
	<nav class="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" aria-label="Settings">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined} class={cn('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap', page.url.pathname === tab.href ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>{tab.label}</a>
		{/each}
	</nav>
	{@render children()}
</div>
