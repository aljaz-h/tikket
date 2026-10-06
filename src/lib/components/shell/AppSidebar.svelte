<script lang="ts">
	import { page } from '$app/state';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Bell from '@lucide/svelte/icons/bell';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import Shield from '@lucide/svelte/icons/shield';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Logo from '../Logo.svelte';
	import ProjectIcon from '../ProjectIcon.svelte';
	import Kbd from '../ui/kbd.svelte';
	import Tooltip from '../ui/tooltip.svelte';
	import UserMenu from './UserMenu.svelte';
	import NotificationBell from './NotificationBell.svelte';
	import ThemeMenu from './ThemeMenu.svelte';
	import { projectPath } from '$lib/shared/format';
	import type { Theme } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	interface Props {
		appName: string;
		user: { displayName: string; username: string; avatarId: string | null; role: string } | null;
		theme: Theme;
		unreadCount: number;
		projects: {
			key: string;
			name: string;
			icon: string | null;
			color: string;
			openCount: number;
		}[];
		collapsed?: boolean;
		mobile?: boolean;
		onsearch: () => void;
		ontogglecollapse?: () => void;
	}
	let {
		appName,
		user,
		theme,
		unreadCount,
		projects,
		collapsed = false,
		mobile = false,
		onsearch,
		ontogglecollapse
	}: Props = $props();

	const currentProjectKey = $derived(page.params.key?.toUpperCase());
	const newTicketHref = $derived(currentProjectKey ? `/new?project=${currentProjectKey}` : '/new');

	const nav = $derived([
		{ href: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
		{ href: '/my-tickets', label: 'My tickets', icon: Ticket, show: !!user },
		{
			href: '/notifications',
			label: 'Notifications',
			icon: Bell,
			show: !!user,
			badge: unreadCount
		},
		{ href: '/projects', label: 'Projects', icon: FolderKanban, show: true },
		{ href: '/admin', label: 'Administration', icon: Shield, show: user?.role === 'admin' }
	]);

	function isActive(href: string) {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}
</script>

<div class="flex h-full flex-col gap-3 p-3">
	<div class={cn('flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
		<a href="/" class="min-w-0 rounded-md px-1 py-1 text-[0.9375rem]" aria-label="{appName} home">
			<Logo name={appName} showName={!collapsed} />
		</a>
		<div class={cn('flex items-center gap-0.5', collapsed && 'flex-col')}>
			{#if user}<NotificationBell count={unreadCount} {collapsed} />{/if}
			{#if !mobile && ontogglecollapse}
				<button
					type="button"
					onclick={ontogglecollapse}
					class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
					aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					aria-expanded={!collapsed}
				>
					{#if collapsed}<PanelLeftOpen class="size-4" />{:else}<PanelLeftClose
							class="size-4"
						/>{/if}
				</button>
			{/if}
		</div>
	</div>

	{#if user}
		<Tooltip text="New ticket" side="right" disabled={!collapsed}>
			{#snippet children({ props })}
				<a
					{...props}
					href={newTicketHref}
					class={cn(
						'inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-card transition-colors hover:bg-primary-hover',
						collapsed ? 'w-9 self-center' : 'w-full'
					)}
				>
					<Plus class="size-4" />
					{#if !collapsed}New ticket{:else}<span class="sr-only">New ticket</span>{/if}
				</a>
			{/snippet}
		</Tooltip>
	{/if}

	<button
		type="button"
		onclick={onsearch}
		class={cn(
			'flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground',
			collapsed && 'w-9 justify-center self-center px-0'
		)}
		aria-label="Search"
	>
		<Search class="size-4 shrink-0" />
		{#if !collapsed}<span class="flex-1 text-left">Search…</span><Kbd>Ctrl K</Kbd>{/if}
	</button>

	<nav aria-label="Main" class="grid gap-0.5">
		{#each nav.filter((n) => n.show) as item (item.href)}
			{@const Icon = item.icon}
			<Tooltip text={item.label} side="right" disabled={!collapsed}>
				{#snippet children({ props })}
					<a
						{...props}
						href={item.href}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class={cn(
							'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
							isActive(item.href) && 'bg-hover font-medium text-foreground',
							collapsed && 'w-9 justify-center self-center px-0'
						)}
					>
						<Icon class="size-4 shrink-0" />
						{#if !collapsed}
							<span class="flex-1 truncate">{item.label}</span>
							{#if item.badge}<span
									class="rounded-full bg-primary-soft px-1.5 text-xs font-medium text-primary"
									>{item.badge}</span
								>{/if}
						{:else}<span class="sr-only">{item.label}</span>{/if}
					</a>
				{/snippet}
			</Tooltip>
		{/each}
	</nav>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if projects.length}
			{#if !collapsed}<p class="px-2 pt-2 pb-1.5 text-xs font-medium text-subtle-foreground">
					Projects
				</p>{/if}
			<ul class="grid gap-0.5" aria-label="Projects">
				{#each projects as project (project.key)}
					{@const active = currentProjectKey === project.key}
					<li>
						<Tooltip text={project.name} side="right" disabled={!collapsed}>
							{#snippet children({ props })}
								<a
									{...props}
									href={projectPath(project.key)}
									aria-current={active ? 'page' : undefined}
									class={cn(
										'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
										active && 'bg-hover font-medium text-foreground',
										collapsed && 'mx-auto w-9 justify-center px-0'
									)}
								>
									<ProjectIcon {project} />
									{#if !collapsed}
										<span class="flex-1 truncate">{project.name}</span>
										{#if project.openCount}<span class="text-xs text-subtle-foreground tabular-nums"
												>{project.openCount}</span
											>{/if}
									{:else}<span class="sr-only">{project.name}</span>{/if}
								</a>
							{/snippet}
						</Tooltip>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="border-t border-border pt-3">
		{#if user}
			<UserMenu {user} {theme} {collapsed} />
		{:else}
			<div class="grid gap-2">
				{#if !collapsed}<ThemeMenu current={theme} />{/if}
				<a
					href="/login?next={encodeURIComponent(page.url.pathname)}"
					class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border text-sm font-medium hover:bg-hover"
				>
					<LogIn class="size-4" />{#if !collapsed}Sign in{/if}
				</a>
			</div>
		{/if}
	</div>
</div>
