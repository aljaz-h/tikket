<script lang="ts">
	import { Popover } from 'bits-ui';
	import { invalidate } from '$app/navigation';
	import Bell from '@lucide/svelte/icons/bell';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import PopoverContent from '../ui/popover-content.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import TimeAgo from '../TimeAgo.svelte';
	import { describeNotification } from '$lib/shared/notifications';
	import { ticketPath, ticketRef } from '$lib/shared/format';
	import type { NotificationType } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	interface Item {
		id: number;
		type: NotificationType;
		data: Record<string, unknown>;
		readAt: string | null;
		createdAt: string;
		projectKey: string | null;
		ticketNumber: number | null;
		ticketTitle: string | null;
		actorName: string | null;
		actorAvatarId: string | null;
	}

	let { count, collapsed = false }: { count: number; collapsed?: boolean } = $props();
	let open = $state(false);
	let loading = $state(false);
	let items = $state<Item[]>([]);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/notifications?limit=8');
			if (res.ok) items = (await res.json()).items;
		} finally {
			loading = false;
		}
	}

	async function markAll() {
		await fetch('/api/notifications', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ all: true })
		});
		items = items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() }));
		await invalidate('app:shell');
	}

	async function openItem(item: Item) {
		open = false;
		if (!item.readAt)
			await fetch('/api/notifications', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ids: [item.id] })
			});
	}
</script>

<Popover.Root bind:open onOpenChange={(o) => o && load()}>
	<Popover.Trigger
		class={cn(
			'relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover',
			collapsed && 'size-9'
		)}
		aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
	>
		<Bell class="size-4" />
		{#if count}
			<span
				class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold text-primary-foreground"
				aria-hidden="true">{count > 99 ? '99+' : count}</span
			>
		{/if}
	</Popover.Trigger>
	<PopoverContent class="w-[22rem] p-0" align="start" side="bottom">
		<div class="flex items-center justify-between border-b border-border px-3 py-2">
			<h2 class="text-sm font-semibold">Notifications</h2>
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-50"
				onclick={markAll}
				disabled={!items.some((i) => !i.readAt)}
			>
				<CheckCheck class="size-3.5" /> Mark all read
			</button>
		</div>
		<div class="max-h-96 overflow-y-auto">
			{#if loading && !items.length}
				<div class="flex justify-center py-8 text-muted-foreground">
					<LoaderCircle class="size-5 animate-spin" />
				</div>
			{:else if !items.length}
				<p class="px-3 py-8 text-center text-sm text-muted-foreground">You’re all caught up.</p>
			{:else}
				<ul>
					{#each items as item (item.id)}
						<li>
							<a
								href={item.projectKey && item.ticketNumber
									? ticketPath(item.projectKey, item.ticketNumber)
									: '/notifications'}
								onclick={() => openItem(item)}
								class="flex gap-2.5 border-b border-border px-3 py-2.5 last:border-0 hover:bg-hover"
							>
								<UserAvatar
									user={{ displayName: item.actorName ?? '?', avatarId: item.actorAvatarId }}
									size="md"
								/>
								<div class="min-w-0 flex-1">
									<p class="text-sm">{describeNotification(item)}</p>
									{#if item.ticketTitle}
										<p class="truncate text-xs text-muted-foreground">
											{item.projectKey && item.ticketNumber
												? ticketRef(item.projectKey, item.ticketNumber)
												: ''} · {item.ticketTitle}
										</p>
									{/if}
									<TimeAgo date={item.createdAt} class="text-xs text-subtle-foreground" />
								</div>
								{#if !item.readAt}<span
										class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
										aria-label="Unread"
									></span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<a
			href="/notifications"
			onclick={() => (open = false)}
			class="block border-t border-border px-3 py-2 text-center text-xs font-medium text-primary hover:bg-hover"
		>
			View all notifications
		</a>
	</PopoverContent>
</Popover.Root>
