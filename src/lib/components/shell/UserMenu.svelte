<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { enhance } from '$app/forms';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import UserIcon from '@lucide/svelte/icons/user';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Bell from '@lucide/svelte/icons/bell';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Shield from '@lucide/svelte/icons/shield';
	import MenuContent from '../ui/menu-content.svelte';
	import MenuItem from '../ui/menu-item.svelte';
	import MenuSeparator from '../ui/menu-separator.svelte';
	import UserAvatar from '../UserAvatar.svelte';
	import ThemeMenu from './ThemeMenu.svelte';
	import type { Theme } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	interface Props {
		user: { displayName: string; username: string; avatarId: string | null; role: string };
		theme: Theme;
		collapsed?: boolean;
	}
	let { user, theme, collapsed = false }: Props = $props();
	let logoutForm: HTMLFormElement | undefined = $state();
</script>

<form method="POST" action="/logout" bind:this={logoutForm} use:enhance class="hidden"></form>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={cn(
			'flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover',
			collapsed && 'justify-center'
		)}
		aria-label="Account menu"
	>
		<UserAvatar {user} size="md" />
		{#if !collapsed}
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium">{user.displayName}</span>
				<span class="block truncate text-xs text-muted-foreground">@{user.username}</span>
			</span>
			<ChevronsUpDown class="size-4 text-muted-foreground" />
		{/if}
	</DropdownMenu.Trigger>
	<MenuContent side="top" align="start" class="w-60">
		<div class="px-2 py-1.5">
			<p class="truncate text-sm font-medium">{user.displayName}</p>
			<p class="truncate text-xs text-muted-foreground">@{user.username}</p>
		</div>
		<MenuSeparator />
		<MenuItem>
			{#snippet child({ props })}<a href="/settings/profile" {...props}><UserIcon /> Profile</a>{/snippet}
		</MenuItem>
		<MenuItem>
			{#snippet child({ props })}<a href="/settings/security" {...props}><KeyRound /> Password & sessions</a>{/snippet}
		</MenuItem>
		<MenuItem>
			{#snippet child({ props })}<a href="/settings/notifications" {...props}><Bell /> Notification settings</a>{/snippet}
		</MenuItem>
		{#if user.role === 'admin'}
			<MenuItem>
				{#snippet child({ props })}<a href="/admin" {...props}><Shield /> Administration</a>{/snippet}
			</MenuItem>
		{/if}
		<MenuSeparator />
		<div class="px-2 py-1.5">
			<p class="mb-1.5 text-xs text-muted-foreground">Theme</p>
			<ThemeMenu current={theme} />
		</div>
		<MenuSeparator />
		<MenuItem onSelect={() => logoutForm?.requestSubmit()}>
			<LogOut /> Sign out
		</MenuItem>
	</MenuContent>
</DropdownMenu.Root>
