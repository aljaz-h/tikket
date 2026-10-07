<script lang="ts">
	import { enhance } from '$app/forms';
	import Monitor from '@lucide/svelte/icons/monitor';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Badge from '$lib/components/ui/badge.svelte';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	function describeAgent(ua: string | null) {
		if (!ua) return 'Unknown device';
		const browser = /Edg\//.test(ua)
			? 'Edge'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'Browser';
		const os = /Windows/.test(ua)
			? 'Windows'
			: /Android/.test(ua)
				? 'Android'
				: /iPhone|iPad/.test(ua)
					? 'iOS'
					: /Mac OS/.test(ua)
						? 'macOS'
						: /Linux/.test(ua)
							? 'Linux'
							: 'Unknown OS';
		return `${browser} on ${os}`;
	}
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Change password</h2>
	<p class="text-sm text-muted-foreground">Changing your password signs you out everywhere else.</p>
	<form
		method="POST"
		action="?/password"
		class="mt-4 grid gap-4"
		use:enhance={quickSubmit({ success: 'Password changed', reset: true })}
	>
		<FormMessage message={errors.form} />
		{#if form && 'passwordChanged' in form}<FormMessage
				variant="success"
				message="Your password was changed and other sessions were signed out."
			/>{/if}
		<Field label="Current password" for="currentPassword" error={errors.currentPassword}
			><Input
				id="currentPassword"
				name="currentPassword"
				type="password"
				autocomplete="current-password"
				required
			/></Field
		>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field
				label="New password"
				for="newPassword"
				error={errors.newPassword}
				hint="At least 10 characters."
				><Input
					id="newPassword"
					name="newPassword"
					type="password"
					autocomplete="new-password"
					required
					minlength={10}
				/></Field
			>
			<Field label="Confirm new password" for="confirmPassword" error={errors.confirmPassword}
				><Input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					required
					minlength={10}
				/></Field
			>
		</div>
		<div class="flex justify-end"><Button type="submit">Change password</Button></div>
	</form>
</Card>

<Card class="p-5 sm:p-6">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h2 class="text-base font-semibold">Active sessions</h2>
			<p class="text-sm text-muted-foreground">Devices that are signed in to your account.</p>
		</div>
		{#if data.sessions.length > 1}
			<form
				method="POST"
				action="?/revokeOthers"
				use:enhance={quickSubmit({ success: 'Other sessions signed out' })}
			>
				<Button type="submit" variant="destructive-outline" size="sm"
					>Sign out other sessions</Button
				>
			</form>
		{/if}
	</div>
	<ul class="mt-4 divide-y divide-border rounded-lg border border-border">
		{#each data.sessions as s (s.id)}
			<li class="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
				<Monitor class="size-4 text-muted-foreground" />
				<div class="min-w-0 flex-1 basis-40">
					<p class="font-medium">
						{describeAgent(s.userAgent)}
						{#if s.current}<Badge variant="tone" class="tone-completed">This device</Badge>{/if}
					</p>
					<p class="text-xs text-muted-foreground">
						{s.ipAddress ?? 'Unknown IP'} · last active <TimeAgo date={s.lastSeenAt} />
					</p>
				</div>
				{#if !s.current}
					<form
						method="POST"
						action="?/revoke"
						use:enhance={quickSubmit({ success: 'Session signed out' })}
					>
						<input type="hidden" name="sessionId" value={s.id} />
						<Button type="submit" size="xs" variant="ghost">Sign out</Button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</Card>
