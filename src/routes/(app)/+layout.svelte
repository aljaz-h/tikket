<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Menu from '@lucide/svelte/icons/menu';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import AppSidebar from '$lib/components/shell/AppSidebar.svelte';
	import SearchDialog from '$lib/components/shell/SearchDialog.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Sheet from '$lib/components/ui/sheet.svelte';
	import { cn } from '$lib/utils';
	import { SIDEBAR_COOKIE } from '$lib/shared/constants';

	let { children, data } = $props();
	// Writable derived: starts from the server-rendered preference, then follows the toggle.
	let collapsed = $derived(data.sidebarCollapsed);
	let mobileOpen = $state(false);
	let searchOpen = $state(false);

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				searchOpen = true;
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	afterNavigate(() => {
		mobileOpen = false;
	});

	function toggleCollapse() {
		collapsed = !collapsed;
		document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
	}

	const sidebarProps = $derived({
		appName: data.app.name,
		user: data.user,
		theme: data.theme,
		unreadCount: data.unreadCount,
		projects: data.sidebarProjects,
		onsearch: () => {
			mobileOpen = false;
			searchOpen = true;
		}
	});
	const newTicketHref = $derived(
		page.params.key ? `/new?project=${page.params.key.toUpperCase()}` : '/new'
	);
</script>

<div class="flex min-h-dvh">
	<aside
		class={cn(
			'sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 lg:block',
			collapsed ? 'w-[4.25rem]' : 'w-64'
		)}
		aria-label="Sidebar"
	>
		<AppSidebar {...sidebarProps} {collapsed} ontogglecollapse={toggleCollapse} />
	</aside>

	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur lg:hidden"
		>
			<button
				type="button"
				class="inline-flex size-10 items-center justify-center rounded-md hover:bg-hover"
				onclick={() => (mobileOpen = true)}
				aria-label="Open navigation"
			>
				<Menu class="size-5" />
			</button>
			<a href="/" class="flex min-w-0 flex-1"><Logo name={data.app.name} class="max-w-full" /></a>
			<button
				type="button"
				class="inline-flex size-10 items-center justify-center rounded-md hover:bg-hover"
				onclick={() => (searchOpen = true)}
				aria-label="Search"
			>
				<Search class="size-5" />
			</button>
			{#if data.user}
				<a
					href={newTicketHref}
					class="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
				>
					<Plus class="size-4" /> New
				</a>
			{/if}
		</header>

		<main id="main" class="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
			{@render children()}
		</main>
	</div>
</div>

<Sheet bind:open={mobileOpen} title="Navigation">
	<AppSidebar {...sidebarProps} mobile />
</Sheet>

<SearchDialog bind:open={searchOpen} />
