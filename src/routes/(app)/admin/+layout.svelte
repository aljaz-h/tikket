<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { cn } from '$lib/utils';
	let { children } = $props();
	const tabs = [
		{ href: '/admin', label: 'Overview', exact: true },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/projects', label: 'Projects' },
		{ href: '/admin/invitations', label: 'Invitations' },
		{ href: '/admin/settings', label: 'Settings' },
		{ href: '/admin/audit', label: 'Audit log' }
	];
	const active = (t: { href: string; exact?: boolean }) => (t.exact ? page.url.pathname === t.href : page.url.pathname.startsWith(t.href));
</script>

<div class="grid gap-6">
	<PageHeader title="Administration" description="Manage users, projects and system-wide settings." />
	<nav class="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0" aria-label="Administration">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={active(tab) ? 'page' : undefined} class={cn('-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap', active(tab) ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>{tab.label}</a>
		{/each}
	</nav>
	{@render children()}
</div>
