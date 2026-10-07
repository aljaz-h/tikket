<script lang="ts">
	import TabNav from '$lib/components/ui/tab-nav.svelte';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	let { children } = $props();
	const tabs = [
		{ href: '/admin', label: 'Overview', exact: true },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/projects', label: 'Projects' },
		{ href: '/admin/invitations', label: 'Invitations' },
		{ href: '/admin/settings', label: 'Settings' },
		{ href: '/admin/email', label: 'Email' },
		{ href: '/admin/health', label: 'Health' },
		{ href: '/admin/queue', label: 'Delivery queue' },
		{ href: '/admin/backups', label: 'Backups' },
		{ href: '/admin/audit', label: 'Audit log' }
	];
	const active = (t: { href: string; exact?: boolean }) =>
		t.exact ? page.url.pathname === t.href : page.url.pathname.startsWith(t.href);
</script>

<div class="grid gap-6">
	<PageHeader
		title="Administration"
		description="Manage users, projects and system-wide settings."
	/>
	<TabNav label="Administration" tabs={tabs.map((t) => ({ ...t, active: active(t) }))} />
	{@render children()}
</div>
