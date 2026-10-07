<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import ProjectIcon from '$lib/components/ProjectIcon.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import { PROJECT_ROLE_META } from '$lib/shared/constants';
	import { formatDate, formatDateTime, projectPath } from '$lib/shared/format';

	let { data, form } = $props();
	const u = $derived(data.target);
	let disableOpen = $state(false);
	let revokeOpen = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const resetLink = $derived(form && 'resetLink' in form ? String(form.resetLink) : '');
</script>

<div class="grid max-w-3xl gap-4">
	<a
		href="/admin/users"
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		><ArrowLeft class="size-4" /> All users</a
	>
	<Card class="flex flex-wrap items-center gap-4 p-5">
		<UserAvatar user={u} size="xl" />
		<div class="min-w-0 flex-1 basis-40">
			<h2 class="text-lg font-semibold">{u.displayName}</h2>
			<p class="text-sm text-muted-foreground">@{u.username} · {u.email}</p>
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#if u.role === 'admin'}<Badge variant="solid">Administrator</Badge>{:else}<Badge
						>Normal user</Badge
					>{/if}
				{#if u.status === 'disabled'}<Badge variant="tone" class="tone-declined">Disabled</Badge
					>{:else}<Badge variant="tone" class="tone-completed">Active</Badge>{/if}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">
				Joined {formatDate(u.createdAt)} · Last sign-in {u.lastLoginAt
					? formatDateTime(u.lastLoginAt)
					: 'never'} · {data.sessionCount} active sessions
			</p>
		</div>
	</Card>
	<FormMessage message={errors.form} />

	<Card class="grid gap-4 p-5">
		<h3 class="text-sm font-semibold">Global role</h3>
		<form
			method="POST"
			action="?/role"
			class="flex flex-wrap items-center gap-2"
			use:enhance={quickSubmit({ success: 'Role updated' })}
		>
			<Select
				name="role"
				value={u.role}
				aria-label="Global role"
				class="w-48"
				disabled={data.isSelf}
				items={[
					{ value: 'user', label: 'Normal user' },
					{ value: 'admin', label: 'Administrator' }
				]}
			/>
			<Button type="submit" variant="secondary" disabled={data.isSelf}>Save role</Button>
			{#if data.isSelf}<p class="text-xs text-muted-foreground">
					You cannot change your own role.
				</p>{/if}
		</form>
	</Card>

	<Card class="grid gap-3 p-5">
		<h3 class="text-sm font-semibold">Security</h3>
		<div class="flex flex-wrap gap-2">
			<form
				method="POST"
				action="?/resetLink"
				use:enhance={quickSubmit({ success: 'Reset link created' })}
			>
				<Button type="submit" variant="secondary">Create password reset link</Button>
			</form>
			{#if !data.isSelf}
				<Button variant="secondary" onclick={() => (revokeOpen = true)}
					>Sign out all sessions</Button
				>
				{#if u.status === 'active'}
					<Button variant="destructive-outline" onclick={() => (disableOpen = true)}
						>Disable account</Button
					>
				{:else}
					<form
						method="POST"
						action="?/enable"
						use:enhance={quickSubmit({ success: 'Account reactivated' })}
					>
						<Button type="submit">Reactivate account</Button>
					</form>
				{/if}
			{/if}
		</div>
		{#if resetLink}
			<div
				class="flex items-center gap-2 rounded-lg border border-primary-border/40 bg-primary-soft p-2"
			>
				<Input
					readonly
					value={resetLink}
					aria-label="Reset link"
					class="h-8 flex-1 font-mono text-xs"
				/>
				<Button
					size="sm"
					onclick={() =>
						navigator.clipboard.writeText(resetLink).then(() => toast.success('Copied'))}
					><Copy /> Copy</Button
				>
			</div>
			<p class="text-xs text-muted-foreground">
				Valid for 24 hours and usable once. Using it signs the user out everywhere.
			</p>
			{#if form && 'emailResult' in form && form.emailResult}
				<FormMessage
					variant={form.emailResult.ok ? 'success' : 'error'}
					message={form.emailResult.ok
						? `${form.emailResult.message}.`
						: `The link could not be emailed (${form.emailResult.message}) – share it yourself.`}
				/>
			{/if}
		{/if}
	</Card>

	<Card class="grid gap-3 p-5">
		<h3 class="text-sm font-semibold">Project memberships</h3>
		{#if data.memberships.length}
			<ul class="divide-y divide-border rounded-lg border border-border">
				{#each data.memberships as m (m.key)}
					<li class="flex items-center gap-3 px-3 py-2 text-sm">
						<ProjectIcon project={m} /><a
							href={projectPath(m.key, 'settings')}
							class="flex-1 hover:underline">{m.name}</a
						><Badge>{PROJECT_ROLE_META[m.role].label}</Badge>
					</li>
				{/each}
			</ul>
		{:else}<p class="text-sm text-muted-foreground">Not a member of any project.</p>{/if}
	</Card>
</div>

<ConfirmDialog
	bind:open={disableOpen}
	title="Disable {u.displayName}?"
	description="They are signed out immediately and cannot sign in. Their tickets and comments remain."
	confirmLabel="Disable"
	destructive
	action="?/disable"
	successMessage="Account disabled"
/>
<ConfirmDialog
	bind:open={revokeOpen}
	title="Sign out all sessions?"
	description="{u.displayName} will have to sign in again on every device."
	confirmLabel="Sign out"
	action="?/revokeSessions"
	successMessage="Sessions revoked"
/>
