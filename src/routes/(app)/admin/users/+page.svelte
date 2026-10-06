<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Link from '@lucide/svelte/icons/link';
	import Search from '@lucide/svelte/icons/search';
	import Copy from '@lucide/svelte/icons/copy';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import AccountFields from '$lib/components/AccountFields.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';

	let { data, form } = $props();
	let createOpen = $state(false);
	let inviteOpen = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const inviteLink = $derived(form && 'inviteLink' in form ? String(form.inviteLink) : '');
</script>

<div class="grid gap-4">
	<div class="flex flex-wrap items-center gap-2">
		<form method="GET" class="relative min-w-0 flex-1 basis-60" role="search">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				name="q"
				value={data.q}
				placeholder="Search by name, username or email"
				aria-label="Search users"
				class="pl-8"
			/>
		</form>
		<Button variant="secondary" onclick={() => (inviteOpen = true)}><Link /> Invite</Button>
		<Button onclick={() => (createOpen = true)}><UserPlus /> Create user</Button>
	</div>
	{#if inviteLink}
		<div
			class="flex items-center gap-2 rounded-lg border border-primary-border/40 bg-primary-soft p-2"
		>
			<Input
				readonly
				value={inviteLink}
				aria-label="Invitation link"
				class="h-8 flex-1 font-mono text-xs"
			/>
			<Button
				size="sm"
				onclick={() =>
					navigator.clipboard.writeText(inviteLink).then(() => toast.success('Copied'))}
				><Copy /> Copy</Button
			>
		</div>
	{/if}
	{#if form && 'created' in form}<FormMessage
			variant="success"
			message="Account @{form.created} created. Share the password securely."
		/>{/if}

	<div class="relative overflow-x-auto rounded-xl border border-border bg-surface">
		<table class="w-full text-sm">
			<thead class="border-b border-border text-left text-xs text-muted-foreground">
				<tr
					><th class="px-4 py-2.5 font-medium">User</th><th class="px-4 py-2.5 font-medium">Role</th
					><th class="hidden px-4 py-2.5 font-medium md:table-cell">Last sign-in</th><th
						class="hidden px-4 py-2.5 font-medium sm:table-cell">Joined</th
					></tr
				>
			</thead>
			<tbody class="divide-y divide-border">
				{#each data.rows as u (u.id)}
					<tr class="hover:bg-hover">
						<td class="px-4 py-2.5">
							<a href="/admin/users/{u.id}" class="flex items-center gap-3">
								<UserAvatar user={u} size="md" />
								<span class="min-w-0">
									<span class="block truncate font-medium">{u.displayName}</span>
									<span class="block truncate text-xs text-muted-foreground"
										>@{u.username} · {u.email}</span
									>
								</span>
							</a>
						</td>
						<td class="px-4 py-2.5">
							<div class="flex flex-wrap gap-1">
								{#if u.role === 'admin'}<Badge variant="solid">Admin</Badge>{:else}<Badge
										>User</Badge
									>{/if}
								{#if u.status === 'disabled'}<Badge variant="tone" class="tone-declined"
										>Disabled</Badge
									>{/if}
							</div>
						</td>
						<td class="hidden px-4 py-2.5 text-muted-foreground md:table-cell"
							>{#if u.lastLoginAt}<TimeAgo date={u.lastLoginAt} />{:else}Never{/if}</td
						>
						<td class="hidden px-4 py-2.5 text-muted-foreground sm:table-cell"
							><TimeAgo date={u.createdAt} /></td
						>
					</tr>
				{:else}
					<tr
						><td colspan="4" class="px-4 py-8 text-center text-muted-foreground">No users found.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
	<Pagination
		page={data.page}
		pages={data.pages}
		total={data.total}
		label="users"
		href={(p) => `?q=${encodeURIComponent(data.q)}&page=${p}`}
	/>
</div>

<Dialog
	bind:open={createOpen}
	title="Create user"
	description="Create an account directly. Share the initial password through a secure channel."
>
	<form
		method="POST"
		action="?/create"
		class="grid gap-4"
		use:enhance={quickSubmit({
			success: 'User created',
			onSuccess: () => (createOpen = false),
			reset: true
		})}
	>
		<FormMessage message={errors.form} />
		<AccountFields {errors} values={(form?.values ?? {}) as Record<string, string>} />
		<Field label="Global role" for="role">
			<Select
				id="role"
				name="role"
				value="user"
				items={[
					{ value: 'user', label: 'Normal user' },
					{ value: 'admin', label: 'Administrator' }
				]}
			/>
		</Field>
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button><Button
				type="submit">Create user</Button
			>
		</div>
	</form>
</Dialog>

<Dialog
	bind:open={inviteOpen}
	title="Invite a user"
	description="Creates a single-use, expiring sign-up link."
>
	<form
		method="POST"
		action="?/invite"
		class="grid gap-4"
		use:enhance={quickSubmit({
			success: 'Invitation link created',
			onSuccess: () => (inviteOpen = false)
		})}
	>
		<Field
			label="Email"
			for="inviteEmail"
			optional
			hint="When set, only this address can accept."
			error={errors.inviteEmail}><Input id="inviteEmail" name="email" type="email" /></Field
		>
		<Field label="Global role" for="inviteRole">
			<Select
				id="inviteRole"
				name="role"
				value="user"
				items={[
					{ value: 'user', label: 'Normal user' },
					{ value: 'admin', label: 'Administrator' }
				]}
			/>
		</Field>
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (inviteOpen = false)}>Cancel</Button><Button
				type="submit">Create link</Button
			>
		</div>
	</form>
</Dialog>
