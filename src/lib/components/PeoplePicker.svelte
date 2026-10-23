<script lang="ts">
	import { enhance } from '$app/forms';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';
	import { quickSubmit } from './ticket/enhance';
	import UserAvatar from './UserAvatar.svelte';
	import Button from './ui/button.svelte';
	import Dialog from './ui/dialog.svelte';
	import Input from './ui/input.svelte';
	import Select from './ui/select.svelte';
	import { PROJECT_ROLES, PROJECT_ROLE_META } from '$lib/shared/constants';

	interface Props {
		people: { id: number; username: string; displayName: string; avatarId: string | null }[];
		/** Form action receiving repeated `userIds` fields and a `role`. */
		action: string;
	}
	let { people, action }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let selected = $state<number[]>([]);

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/^@/, '');
		return q
			? people.filter(
					(p) => p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
				)
			: people;
	});
	const allShownSelected = $derived(
		shown.length > 0 && shown.every((p) => selected.includes(p.id))
	);
	function toggle(id: number, on: boolean) {
		selected = on ? [...selected, id] : selected.filter((n) => n !== id);
	}
	function toggleAll() {
		const ids = shown.map((p) => p.id);
		selected = allShownSelected
			? selected.filter((n) => !ids.includes(n))
			: [...new Set([...selected, ...ids])];
	}
</script>

<Button type="button" variant="secondary" onclick={() => (open = true)}>
	<Users /> Choose people…
</Button>

<Dialog
	bind:open
	size="lg"
	title="Add people to this project"
	description="Everyone listed has an account and is not a member yet. Select people and choose their role."
>
	<form
		method="POST"
		{action}
		class="grid gap-3"
		use:enhance={quickSubmit({
			success: 'Members added',
			onSuccess: () => {
				open = false;
				selected = [];
				query = '';
			}
		})}
	>
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={query}
				placeholder="Search by name or username"
				aria-label="Search people"
				class="pl-8"
			/>
		</div>
		<div class="flex items-center justify-between text-xs text-muted-foreground">
			<span aria-live="polite">{shown.length} available · {selected.length} selected</span>
			{#if shown.length}
				<button type="button" class="text-link hover:underline" onclick={toggleAll}>
					{allShownSelected ? 'Clear shown' : 'Select all shown'}
				</button>
			{/if}
		</div>
		<ul
			class="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-surface"
			aria-label="People who can be added"
		>
			{#each shown as p (p.id)}
				<li>
					<label class="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover">
						<input
							type="checkbox"
							checked={selected.includes(p.id)}
							onchange={(e) => toggle(p.id, e.currentTarget.checked)}
						/>
						<UserAvatar user={p} size="md" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{p.displayName}</span>
							<span class="block truncate text-xs text-muted-foreground">@{p.username}</span>
						</span>
					</label>
				</li>
			{:else}
				<li class="px-3 py-8 text-center text-sm text-muted-foreground">
					{query
						? 'Nobody matches your search.'
						: 'Everyone with an account is already a member. Invite someone new instead.'}
				</li>
			{/each}
		</ul>
		{#each selected as id (id)}<input type="hidden" name="userIds" value={id} />{/each}
		<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
			<div class="grid gap-1.5 sm:w-48">
				<span class="text-[0.8125rem] font-medium" id="picker-role-label">Role</span>
				<Select
					name="role"
					value="member"
					aria-label="Role for the selected people"
					items={PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE_META[r].label }))}
				/>
			</div>
			<div class="flex flex-col-reverse gap-2 sm:flex-row">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!selected.length}>
					Add {selected.length || ''}
					{selected.length === 1 ? 'person' : 'people'}
				</Button>
			</div>
		</div>
	</form>
</Dialog>
