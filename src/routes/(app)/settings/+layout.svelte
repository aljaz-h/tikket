<script lang="ts">
	import TabNav from '$lib/components/ui/tab-nav.svelte';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	let { children } = $props();
	const tabs = [
		{ href: '/settings/profile', label: 'Profile' },
		{ href: '/settings/security', label: 'Password & sessions' },
		{ href: '/settings/notifications', label: 'Notifications' },
		{ href: '/settings/data', label: 'Your data' }
	];
</script>

<div class="mx-auto grid max-w-3xl gap-6">
	<PageHeader title="Account settings" />
	<TabNav
		label="Settings"
		tabs={tabs.map((t) => ({ ...t, active: page.url.pathname === t.href }))}
	/>
	{@render children()}
</div>
