<script lang="ts">
	import { enhance } from '$app/forms';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Settings from '@lucide/svelte/icons/settings';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { describeNotification } from '$lib/shared/notifications';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import { cn } from '$lib/utils';

	let { data } = $props();
</script>

<div class="mx-auto grid max-w-3xl gap-6">
	<PageHeader title="Notifications">
		{#snippet actions()}
			<Button href="/settings/notifications" variant="ghost" size="sm"><Settings /> Preferences</Button>
			<form method="POST" action="?/markAll" use:enhance>
				<Button type="submit" variant="secondary" size="sm" disabled={!data.items.some((i) => !i.readAt)}><CheckCheck /> Mark all as read</Button>
			</form>
		{/snippet}
	</PageHeader>
	<nav class="flex gap-1 border-b border-border" aria-label="Filter">
		{#each [{ label: 'All', href: '/notifications', active: !data.unreadOnly }, { label: 'Unread', href: '/notifications?filter=unread', active: data.unreadOnly }] as tab (tab.label)}
			<a href={tab.href} aria-current={tab.active ? 'page' : undefined} class={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab.active ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>{tab.label}</a>
		{/each}
	</nav>
	{#if data.items.length}
		<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
			{#each data.items as n (n.id)}
				<li>
					<a href={n.projectKey && n.ticketNumber ? ticketPath(n.projectKey, n.ticketNumber) : '#'} class={cn('flex gap-3 px-4 py-3 hover:bg-hover', !n.readAt && 'bg-primary-soft/40')}>
						<UserAvatar user={{ displayName: n.actorName ?? '?', avatarId: n.actorAvatarId }} size="md" />
						<div class="min-w-0 flex-1">
							<p class="text-sm">{describeNotification(n)}</p>
							{#if n.ticketTitle && n.projectKey && n.ticketNumber}
								<p class="truncate text-sm text-muted-foreground"><span class="font-mono text-xs">{ticketRef(n.projectKey, n.ticketNumber)}</span> {n.ticketTitle}</p>
							{/if}
							{#if typeof n.data.excerpt === 'string' && n.data.excerpt}
								<p class="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">{n.data.excerpt}</p>
							{/if}
							<TimeAgo date={n.createdAt} class="text-xs text-subtle-foreground" />
						</div>
						{#if !n.readAt}<span class="mt-2 size-2 shrink-0 rounded-full bg-primary"><span class="sr-only">Unread</span></span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<EmptyState icon={BellOff} title={data.unreadOnly ? 'No unread notifications' : 'No notifications yet'} description="Follow tickets to hear about comments and status changes." />
	{/if}
</div>
