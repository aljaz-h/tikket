<script lang="ts">
	import { page } from '$app/state';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Bell from '@lucide/svelte/icons/bell';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
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
			logoId?: string | null;
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

	// Everyday navigation only: administration lives in the account menu.
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
		{ href: '/projects', label: 'Projects', icon: FolderKanban, show: true }
	]);

	function isActive(href: string) {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}

	/*
	 * One geometry for every control: full-width rows when expanded, 36 px squares centred in
	 * the rail when collapsed. Centring comes from the column layout, never per-item margins.
	 */
	const item = $derived(
		cn(
			'flex h-9 items-center gap-2.5 rounded-md text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
			collapsed ? 'w-9 shrink-0 justify-center' : 'w-full px-2'
		)
	);

	/** Collapsed rail: a click on empty space (not on a control) expands the sidebar. */
	function expandFromBackground(e: MouseEvent) {
		if (!collapsed || !ontogglecollapse) return;
		const target = e.target as Element | null;
		if (
			target?.closest(
				'a, button, input, select, textarea, label, [role="menu"], [role="menuitem"], [data-sidebar-control]'
			)
		)
			return;
		ontogglecollapse();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<!-- Pointer convenience only; keyboard users have the explicit expand button below. -->
<div
	class={cn(
		'flex h-full flex-col gap-3 py-3',
		collapsed ? 'cursor-e-resize items-center px-2' : 'px-3'
	)}
	onclick={expandFromBackground}
>
	<div class={cn('flex w-full items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
		<a
			href="/"
			class={cn(
				'flex min-w-0 items-center rounded-md text-[0.9375rem]',
				collapsed ? 'size-9 justify-center' : 'px-1 py-1'
			)}
			aria-label="{appName} home"
		>
			<Logo name={appName} showName={!collapsed} size={collapsed ? 'sm' : 'md'} />
		</a>
		<div class={cn('flex items-center gap-0.5', collapsed && 'flex-col')}>
			<!-- When collapsed, the Notifications entry below carries the unread indicator. -->
			{#if user && !collapsed}<NotificationBell count={unreadCount} />{/if}
			{#if !mobile && ontogglecollapse}
				<Tooltip text={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
					{#snippet children({ props })}
						<button
							{...props}
							type="button"
							onclick={ontogglecollapse}
							class={cn(item, 'w-9 justify-center px-0')}
							aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
							aria-expanded={!collapsed}
						>
							{#if collapsed}<PanelLeftOpen class="size-4" />{:else}<PanelLeftClose
									class="size-4"
								/>{/if}
						</button>
					{/snippet}
				</Tooltip>
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
						item,
						'justify-center bg-primary font-medium text-primary-foreground shadow-card hover:bg-primary-hover hover:text-primary-foreground'
					)}
				>
					<Plus class="size-4" />
					{#if !collapsed}New ticket{:else}<span class="sr-only">New ticket</span>{/if}
				</a>
			{/snippet}
		</Tooltip>
	{/if}

	<Tooltip text="Search (Ctrl K)" side="right" disabled={!collapsed}>
		{#snippet children({ props })}
			<button
				{...props}
				type="button"
				onclick={onsearch}
				class={cn(
					item,
					'h-8 border border-border bg-surface hover:border-border-strong',
					collapsed && 'h-9'
				)}
				aria-label="Search"
			>
				<Search class="size-4 shrink-0" />
				{#if !collapsed}<span class="flex-1 text-left">Search…</span><Kbd>Ctrl K</Kbd>{/if}
			</button>
		{/snippet}
	</Tooltip>

	<nav aria-label="Main" class={cn('grid w-full gap-0.5', collapsed && 'justify-items-center')}>
		{#each nav.filter((n) => n.show) as entry (entry.href)}
			{@const Icon = entry.icon}
			<Tooltip text={entry.label} side="right" disabled={!collapsed}>
				{#snippet children({ props })}
					<a
						{...props}
						href={entry.href}
						aria-current={isActive(entry.href) ? 'page' : undefined}
						class={cn(
							item,
							'relative',
							isActive(entry.href) && 'bg-hover font-medium text-foreground [&>svg]:text-link'
						)}
					>
						<Icon class="size-4 shrink-0" />
						{#if !collapsed}
							<span class="flex-1 truncate">{entry.label}</span>
							{#if entry.badge}<span
									class="rounded-full bg-primary-soft px-1.5 text-xs font-medium text-link"
									>{entry.badge}</span
								>{/if}
						{:else}
							<span class="sr-only"
								>{entry.label}{entry.badge ? `, ${entry.badge} unread` : ''}</span
							>
							{#if entry.badge}<span
									class="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar"
									aria-hidden="true"
								></span>{/if}
						{/if}
					</a>
				{/snippet}
			</Tooltip>
		{/each}
	</nav>

	<div
		class={cn('min-h-0 w-full flex-1 overflow-y-auto', collapsed && 'flex flex-col items-center')}
	>
		{#if projects.length}
			{#if collapsed}<div class="mb-2 h-px w-6 bg-border" aria-hidden="true"></div>{:else}<p
					class="px-2 pt-2 pb-1.5 text-xs font-medium text-subtle-foreground"
				>
					Projects
				</p>{/if}
			<ul
				class={cn('grid w-full gap-0.5', collapsed && 'justify-items-center')}
				aria-label="Projects"
			>
				{#each projects as project (project.key)}
					{@const active = currentProjectKey === project.key}
					<li class={cn(!collapsed && 'w-full')}>
						<Tooltip text={project.name} side="right" disabled={!collapsed}>
							{#snippet children({ props })}
								<a
									{...props}
									href={projectPath(project.key)}
									aria-current={active ? 'page' : undefined}
									class={cn(item, active && 'bg-hover font-medium text-foreground')}
								>
									<ProjectIcon {project} size="sm" />
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

	<div class={cn('w-full border-t border-border pt-3', collapsed && 'flex justify-center')}>
		{#if user}
			<UserMenu {user} {theme} {collapsed} />
		{:else}
			<div class={cn('grid w-full gap-2', collapsed && 'justify-items-center')}>
				{#if !collapsed}<ThemeMenu current={theme} />{/if}
				<a
					href="/login?next={encodeURIComponent(page.url.pathname)}"
					class={cn(item, 'justify-center border border-border font-medium text-foreground')}
					aria-label="Sign in"
				>
					<LogIn class="size-4" />{#if !collapsed}Sign in{/if}
				</a>
			</div>
		{/if}
	</div>
</div>
