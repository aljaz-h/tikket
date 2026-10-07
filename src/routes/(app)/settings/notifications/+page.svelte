<script lang="ts">
	import { enhance } from '$app/forms';
	import Bell from '@lucide/svelte/icons/bell';
	import Mail from '@lucide/svelte/icons/mail';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { NOTIFICATION_PREF_META, NOTIFICATION_TYPES } from '$lib/shared/constants';

	let { data } = $props();
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Notifications</h2>
	<p class="text-sm text-muted-foreground">
		Choose what appears under the bell{data.emailEnabled ? ' and what is emailed to you' : ''}. You
		automatically follow tickets you create or comment on.
	</p>
	{#if data.emailEnabled}
		<p class="mt-1 text-xs text-muted-foreground">
			Emails go to <span class="font-medium text-foreground">{data.email}</span> (change it under
			<a href="/settings/profile" class="text-link hover:underline">Profile</a>).
		</p>
	{:else}
		<p class="mt-1 text-xs text-muted-foreground">
			Email notifications are not available: your administrator has not configured email.
		</p>
	{/if}
	<form
		method="POST"
		class="mt-5 grid gap-1"
		use:enhance={quickSubmit({ success: 'Preferences saved' })}
	>
		{#if data.emailEnabled}<input type="hidden" name="emailForm" value="1" />{/if}
		<div
			class="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-end gap-x-3 border-b border-border pb-2 text-xs font-medium text-muted-foreground"
			class:!grid-cols-[minmax(0,1fr)_3.5rem]={!data.emailEnabled}
			aria-hidden="true"
		>
			<span>Category</span>
			<span class="flex flex-col items-center gap-0.5"><Bell class="size-3.5" />In-app</span>
			{#if data.emailEnabled}<span class="flex flex-col items-center gap-0.5"
					><Mail class="size-3.5" />Email</span
				>{/if}
		</div>
		{#each NOTIFICATION_TYPES as type (type)}
			<div
				class="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-3 border-b border-border py-3 last-of-type:border-0"
				class:!grid-cols-[minmax(0,1fr)_3.5rem]={!data.emailEnabled}
			>
				<span id="pref-{type}">
					<span class="block text-sm font-medium">{NOTIFICATION_PREF_META[type].label}</span>
					<span class="block text-xs text-muted-foreground"
						>{NOTIFICATION_PREF_META[type].hint}</span
					>
				</span>
				<span class="flex justify-center">
					<Switch
						name={type}
						checked={data.prefs[type]}
						aria-label="In-app: {NOTIFICATION_PREF_META[type].label}"
					/>
				</span>
				{#if data.emailEnabled}
					<span class="flex justify-center">
						<Switch
							name="email:{type}"
							checked={data.emailPrefs[type]}
							aria-label="Email: {NOTIFICATION_PREF_META[type].label}"
						/>
					</span>
				{/if}
			</div>
		{/each}
		<div class="flex justify-end border-t border-border pt-4">
			<Button type="submit">Save preferences</Button>
		</div>
	</form>
</Card>
