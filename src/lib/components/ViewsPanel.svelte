<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { deserialize } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { DropdownMenu } from 'bits-ui';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Users from '@lucide/svelte/icons/users';
	import User from '@lucide/svelte/icons/user';
	import Bookmark from '@lucide/svelte/icons/bookmark';
	import Plus from '@lucide/svelte/icons/plus';
	import Dialog from './ui/dialog.svelte';
	import Field from './ui/field.svelte';
	import Input from './ui/input.svelte';
	import Button from './ui/button.svelte';
	import Checkbox from './ui/checkbox.svelte';
	import Select from './ui/select.svelte';
	import { menuContentClass, menuItemClass } from './ui/menu-styles';
	import { BUILT_IN_VIEWS } from '$lib/shared/views';
	import { normaliseViewQuery } from '$lib/shared/filters';
	import type { TicketColumn } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	interface View {
		id: number;
		name: string;
		query: string;
		columns: TicketColumn[];
		shared: boolean;
		canManage: boolean;
	}
	interface Props {
		views: View[];
		base: string;
		/** Normalised query of the list being shown (filters + sort). */
		query: string;
		columns: TicketColumn[];
		savedId: number | null;
		signedIn: boolean;
		isStaff: boolean;
		/** Extra params kept when switching views (e.g. the board/list mode). */
		keep?: Record<string, string>;
	}
	let { views, base, query, columns, savedId, signedIn, isStaff, keep = {} }: Props = $props();

	const builtIns = $derived(
		BUILT_IN_VIEWS.filter((v) => (!v.signedIn || signedIn) && (!v.staff || isStaff)).map((v) => ({
			...v,
			query: normaliseViewQuery(v.query)
		}))
	);
	const shared = $derived(views.filter((v) => v.shared));
	const personal = $derived(views.filter((v) => !v.shared));
	const active = $derived(views.find((v) => v.id === savedId) ?? null);
	const modified = $derived(
		!!active && (active.query !== query || active.columns.join(',') !== columns.join(','))
	);
	const activeBuiltIn = $derived(savedId ? null : builtIns.find((v) => v.query === query));

	const withKeep = (params: URLSearchParams) => {
		for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
		return params;
	};
	const viewHref = (v: View) => {
		// A throwaway value for building a link, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const p = new URLSearchParams(v.query);
		if (v.columns.length) p.set('cols', v.columns.join(','));
		p.set('saved', String(v.id));
		return `${base}?${withKeep(p)}`;
	};
	const builtInHref = (q: string) =>
		`${base}${q || Object.keys(keep).length ? `?${withKeep(new URLSearchParams(q))}` : ''}`;

	async function post(action: string, data: Record<string, string>, success?: string) {
		const body = new FormData();
		for (const [k, v] of Object.entries(data)) body.set(k, v);
		const res = await fetch(`${base}?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true', accept: 'application/json' }
		});
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			const errors = (result.data?.errors ?? {}) as Record<string, string>;
			toast.error(Object.values(errors)[0] ?? 'That did not work');
			return null;
		}
		if (result.type !== 'success') {
			toast.error('That did not work');
			return null;
		}
		if (success) toast.success(success);
		await invalidateAll();
		return result.data as Record<string, unknown>;
	}

	// ── Save / rename dialogs ──
	let saveOpen = $state(false);
	let renaming = $state<View | null>(null);
	let renameOpen = $state(false);
	let name = $state('');
	let share = $state(false);
	let busy = $state(false);

	export function openSave() {
		name = '';
		share = false;
		saveOpen = true;
	}
	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		const data = await post(
			'saveView',
			{
				name,
				query,
				columns: columns.join(','),
				...(share ? { shared: 'on' } : {})
			},
			'View saved'
		);
		busy = false;
		if (data?.savedView) {
			saveOpen = false;
			await goto(viewHref(data.savedView as View), { noScroll: true });
		}
	}
	async function rename(e: SubmitEvent) {
		e.preventDefault();
		if (!renaming) return;
		busy = true;
		const data = await post('updateView', { viewId: String(renaming.id), name }, 'View renamed');
		busy = false;
		if (data) renameOpen = false;
	}
	async function updateActive() {
		if (!active) return;
		await post(
			'updateView',
			{ viewId: String(active.id), query, columns: columns.join(',') },
			`“${active.name}” updated`
		);
	}
	async function duplicate(v: View) {
		const data = await post('duplicateView', { viewId: String(v.id) }, 'View duplicated');
		if (data?.savedView) await goto(viewHref(data.savedView as View), { noScroll: true });
	}
	async function remove(v: View) {
		const data = await post('deleteView', { viewId: String(v.id) }, `“${v.name}” deleted`);
		if (data && v.id === savedId) await goto(base, { noScroll: true });
	}

	const mobileItems = $derived([
		...builtIns.map((v) => ({ value: `b:${v.key}`, label: v.name, group: 'Views' })),
		...shared.map((v) => ({ value: `s:${v.id}`, label: v.name, group: 'Shared views' })),
		...personal.map((v) => ({ value: `s:${v.id}`, label: v.name, group: 'My views' }))
	]);
	const mobileValue = $derived(
		active ? `s:${active.id}` : activeBuiltIn ? `b:${activeBuiltIn.key}` : ''
	);
	function pick(value: string) {
		const [kind, id] = value.split(':');
		if (kind === 'b') {
			const v = builtIns.find((x) => x.key === id);
			if (v) goto(builtInHref(v.query), { noScroll: true });
		} else {
			const v = views.find((x) => String(x.id) === id);
			if (v) goto(viewHref(v), { noScroll: true });
		}
	}
</script>

{#snippet item(v: View)}
	{@const isActive = v.id === savedId}
	<li class="group/view relative flex items-center">
		<a
			href={viewHref(v)}
			data-sveltekit-noscroll
			aria-current={isActive ? 'page' : undefined}
			class={cn(
				'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 pr-8 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
				isActive && 'bg-hover font-medium text-foreground'
			)}
		>
			{#if v.shared}<Users class="size-3.5 shrink-0" />{:else}<User
					class="size-3.5 shrink-0"
				/>{/if}
			<span class="truncate">{v.name}</span>
			{#if isActive && modified}<span
					class="size-1.5 shrink-0 rounded-full bg-primary"
					title="Modified"
				></span>{/if}
		</a>
		{#if signedIn}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="absolute right-1 inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-70 group-hover/view:opacity-100 hover:bg-surface hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
					aria-label="Options for view {v.name}"
				>
					<Ellipsis class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content class={menuContentClass} align="start" sideOffset={4}>
						{#if v.canManage}
							{#if isActive && modified}
								<DropdownMenu.Item class={menuItemClass} onSelect={updateActive}
									>Save current filters</DropdownMenu.Item
								>
							{/if}
							<DropdownMenu.Item
								class={menuItemClass}
								onSelect={() => {
									renaming = v;
									name = v.name;
									renameOpen = true;
								}}>Rename…</DropdownMenu.Item
							>
						{/if}
						<DropdownMenu.Item class={menuItemClass} onSelect={() => duplicate(v)}
							>Duplicate</DropdownMenu.Item
						>
						{#if v.canManage}
							<DropdownMenu.Item
								class={menuItemClass}
								onSelect={() => post('moveView', { viewId: String(v.id), direction: 'up' })}
								>Move up</DropdownMenu.Item
							>
							<DropdownMenu.Item
								class={menuItemClass}
								onSelect={() => post('moveView', { viewId: String(v.id), direction: 'down' })}
								>Move down</DropdownMenu.Item
							>
							<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
							<DropdownMenu.Item
								class={cn(menuItemClass, 'text-destructive')}
								onSelect={() => remove(v)}>Delete</DropdownMenu.Item
							>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/if}
	</li>
{/snippet}

<!-- Phones and tablets: one compact dropdown. -->
<div class="flex items-center gap-2 lg:hidden">
	<Select
		aria-label="Ticket view"
		placeholder="Custom filters"
		value={mobileValue}
		items={mobileItems}
		onchange={pick}
		class="min-w-0 flex-1"
	/>
	{#if signedIn}
		{#if active && modified && active.canManage}
			<Button variant="secondary" onclick={updateActive}>Update view</Button>
		{/if}
		<Button variant="outline" onclick={openSave} aria-label="Save view"
			><Bookmark /> <span class="hidden sm:inline">Save view</span></Button
		>
	{/if}
</div>

<!-- Desktop: a compact list beside the tickets. -->
<nav class="hidden content-start gap-4 lg:grid" aria-label="Ticket views">
	<div class="grid gap-0.5">
		<p class="px-2 pb-1 text-xs font-medium text-subtle-foreground">Views</p>
		<ul class="grid gap-0.5">
			{#each builtIns as v (v.key)}
				<li>
					<a
						href={builtInHref(v.query)}
						data-sveltekit-noscroll
						aria-current={activeBuiltIn?.key === v.key ? 'page' : undefined}
						class={cn(
							'flex h-8 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
							activeBuiltIn?.key === v.key && 'bg-hover font-medium text-foreground'
						)}>{v.name}</a
					>
				</li>
			{/each}
		</ul>
	</div>
	{#if shared.length}
		<div class="grid gap-0.5">
			<p class="px-2 pb-1 text-xs font-medium text-subtle-foreground">Shared views</p>
			<ul class="grid gap-0.5">
				{#each shared as v (v.id)}{@render item(v)}{/each}
			</ul>
		</div>
	{/if}
	{#if personal.length}
		<div class="grid gap-0.5">
			<p class="px-2 pb-1 text-xs font-medium text-subtle-foreground">My views</p>
			<ul class="grid gap-0.5">
				{#each personal as v (v.id)}{@render item(v)}{/each}
			</ul>
		</div>
	{/if}
	{#if signedIn}
		<div class="grid gap-1.5">
			{#if active && modified && active.canManage}
				<Button size="sm" variant="secondary" onclick={updateActive}>Update “{active.name}”</Button>
			{/if}
			<Button size="sm" variant="ghost" class="justify-start" onclick={openSave}
				><Plus /> Save current view</Button
			>
		</div>
	{/if}
</nav>

<Dialog
	bind:open={saveOpen}
	title="Save view"
	description="Saves the current filters, sort order and columns."
	size="sm"
>
	<form class="grid gap-4" onsubmit={save}>
		<Field label="Name" for="view-name" required>
			<Input
				id="view-name"
				bind:value={name}
				maxlength={60}
				required
				placeholder="High priority bugs"
			/>
		</Field>
		{#if isStaff}
			<label class="flex items-start gap-2 text-sm">
				<Checkbox bind:checked={share} class="mt-0.5" />
				<span
					>Share with the project<span class="block text-xs text-muted-foreground"
						>Everyone who can see this project gets the view. Only staff can change it.</span
					></span
				>
			</label>
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (saveOpen = false)}>Cancel</Button>
			<Button type="submit" loading={busy}>Save view</Button>
		</div>
	</form>
</Dialog>

<Dialog bind:open={renameOpen} title="Rename view" size="sm">
	<form class="grid gap-4" onsubmit={rename}>
		<Field label="Name" for="view-rename" required>
			<Input id="view-rename" bind:value={name} maxlength={60} required />
		</Field>
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (renameOpen = false)}>Cancel</Button>
			<Button type="submit" loading={busy}>Rename</Button>
		</div>
	</form>
</Dialog>
