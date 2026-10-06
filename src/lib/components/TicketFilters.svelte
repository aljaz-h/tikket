<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import X from '@lucide/svelte/icons/x';
	import List from '@lucide/svelte/icons/list';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import NativeSelect from './ui/native-select.svelte';
	import Input from './ui/input.svelte';
	import Button from './ui/button.svelte';
	import { activeFilterCount, filtersToParams, SORTS, type TicketFilters } from '$lib/shared/filters';
	import { PRIORITY_META, STATUS_META, TICKET_PRIORITIES, TICKET_STATUSES, TICKET_TYPES, TYPE_META } from '$lib/shared/constants';
	import { cn } from '$lib/utils';

	interface Props {
		filters: TicketFilters;
		view?: 'list' | 'board' | null;
		labels?: { id: number; name: string; color: string }[];
		assignable?: { id: number; username: string; displayName: string }[];
		showAssignee?: boolean;
		showReporter?: boolean;
		extraParams?: Record<string, string>;
	}
	let { filters, view = null, labels = [], assignable = [], showAssignee = true, showReporter = true, extraParams = {} }: Props = $props();

	let formEl: HTMLFormElement | undefined = $state();
	let detailsEl: HTMLDetailsElement | undefined = $state();

	$effect(() => {
		// Close the filter panel when clicking elsewhere.
		const onClick = (e: MouseEvent) => {
			if (detailsEl?.open && !detailsEl.contains(e.target as Node)) detailsEl.open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && detailsEl?.open) {
				detailsEl.open = false;
				detailsEl.querySelector('summary')?.focus();
			}
		};
		document.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	});
	const count = $derived(activeFilterCount(filters));
	const pathname = $derived(page.url.pathname);

	function submit() {
		formEl?.requestSubmit();
	}

	function hrefWith(patch: Partial<TicketFilters>, extra: Record<string, string> = {}) {
		const params = filtersToParams({ ...filters, page: 1, ...patch }, { ...extraParams, ...(view ? { view } : {}), ...extra });
		const qs = params.toString();
		return qs ? `${pathname}?${qs}` : pathname;
	}

	type Chip = { label: string; href: string };
	const chips = $derived.by(() => {
		const out: Chip[] = [];
		for (const s of filters.status) out.push({ label: STATUS_META[s].label, href: hrefWith({ status: filters.status.filter((x) => x !== s) }) });
		for (const t of filters.type) out.push({ label: TYPE_META[t].short, href: hrefWith({ type: filters.type.filter((x) => x !== t) }) });
		for (const p of filters.priority) out.push({ label: `${PRIORITY_META[p].label} priority`, href: hrefWith({ priority: filters.priority.filter((x) => x !== p) }) });
		for (const l of filters.labels) out.push({ label: labels.find((x) => x.id === l)?.name ?? 'Label', href: hrefWith({ labels: filters.labels.filter((x) => x !== l) }) });
		if (filters.reporter) out.push({ label: `Reporter: ${filters.reporter}`, href: hrefWith({ reporter: '' }) });
		if (filters.assignee) out.push({ label: `Assignee: ${filters.assignee === 'none' ? 'nobody' : filters.assignee}`, href: hrefWith({ assignee: '' }) });
		if (filters.createdFrom || filters.createdTo) out.push({ label: `Created ${filters.createdFrom || '…'} – ${filters.createdTo || '…'}`, href: hrefWith({ createdFrom: '', createdTo: '' }) });
		if (filters.updatedFrom || filters.updatedTo) out.push({ label: `Updated ${filters.updatedFrom || '…'} – ${filters.updatedTo || '…'}`, href: hrefWith({ updatedFrom: '', updatedTo: '' }) });
		return out;
	});
</script>

<form bind:this={formEl} method="GET" action={pathname} class="grid gap-3" data-sveltekit-keepfocus data-sveltekit-noscroll>
	{#if view}<input type="hidden" name="view" value={view} />{/if}
	{#each Object.entries(extraParams) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
	<div class="flex flex-wrap items-center gap-2">
		<div class="relative min-w-0 flex-1 basis-56">
			<Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type="search"
				name="q"
				value={filters.q}
				placeholder="Search tickets…"
				aria-label="Search tickets"
				class="pl-8"
				onkeydown={(e) => {
					if (e.key === 'Escape' && filters.q) goto(hrefWith({ q: '' }), { keepFocus: true, noScroll: true });
				}}
			/>
		</div>

		<details bind:this={detailsEl} class="group/filters relative">
			<summary class={cn('inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium select-none hover:bg-hover group-open/filters:bg-hover [&::-webkit-details-marker]:hidden', count && 'border-primary/50')}>
				<SlidersHorizontal class="size-4" /> Filters
				{#if count}<span class="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{count}</span>{/if}
			</summary>
			<div class="absolute top-full left-0 z-40 mt-1.5 w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-4 shadow-pop sm:right-0 sm:left-auto">
				<div class="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
					<fieldset>
						<legend class="mb-2 text-xs font-semibold text-muted-foreground">Status</legend>
						<div class="flex flex-wrap gap-1.5">
							{#each TICKET_STATUSES as s (s)}
								<label class="cursor-pointer rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
									<input type="checkbox" name="status" value={s} checked={filters.status.includes(s)} class="sr-only" />{STATUS_META[s].label}
								</label>
							{/each}
						</div>
					</fieldset>
					<fieldset>
						<legend class="mb-2 text-xs font-semibold text-muted-foreground">Type</legend>
						<div class="flex flex-wrap gap-1.5">
							{#each TICKET_TYPES as t (t)}
								<label class="cursor-pointer rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
									<input type="checkbox" name="type" value={t} checked={filters.type.includes(t)} class="sr-only" />{TYPE_META[t].short}
								</label>
							{/each}
						</div>
					</fieldset>
					<fieldset>
						<legend class="mb-2 text-xs font-semibold text-muted-foreground">Priority</legend>
						<div class="flex flex-wrap gap-1.5">
							{#each TICKET_PRIORITIES as p (p)}
								<label class="cursor-pointer rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
									<input type="checkbox" name="priority" value={p} checked={filters.priority.includes(p)} class="sr-only" />{PRIORITY_META[p].label}
								</label>
							{/each}
						</div>
					</fieldset>
					{#if labels.length}
						<fieldset>
							<legend class="mb-2 text-xs font-semibold text-muted-foreground">Labels</legend>
							<div class="flex flex-wrap gap-1.5">
								{#each labels as l (l.id)}
									<label class="cursor-pointer rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
										<input type="checkbox" name="label" value={l.id} checked={filters.labels.includes(l.id)} class="sr-only" />
										<span class="swatch-{l.color} swatch-solid mr-1 inline-block size-2 rounded-full"></span>{l.name}
									</label>
								{/each}
							</div>
						</fieldset>
					{/if}
					<div class="grid gap-3 sm:grid-cols-2">
						{#if showReporter}
							<label class="grid gap-1 text-xs font-semibold text-muted-foreground">
								Reporter (username)
								<Input name="reporter" value={filters.reporter} placeholder="me or username" class="h-8 font-normal" />
							</label>
						{/if}
						{#if showAssignee}
							<label class="grid gap-1 text-xs font-semibold text-muted-foreground">
								Assignee
								<NativeSelect name="assignee" value={filters.assignee} class="font-normal [&_select]:h-8">
									<option value="">Anyone</option>
									<option value="me">Me</option>
									<option value="none">Unassigned</option>
									{#each assignable as u (u.id)}<option value={u.username}>{u.displayName}</option>{/each}
								</NativeSelect>
							</label>
						{/if}
						<label class="grid gap-1 text-xs font-semibold text-muted-foreground">Created from<Input type="date" name="createdFrom" value={filters.createdFrom} class="h-8 font-normal" /></label>
						<label class="grid gap-1 text-xs font-semibold text-muted-foreground">Created to<Input type="date" name="createdTo" value={filters.createdTo} class="h-8 font-normal" /></label>
						<label class="grid gap-1 text-xs font-semibold text-muted-foreground">Updated from<Input type="date" name="updatedFrom" value={filters.updatedFrom} class="h-8 font-normal" /></label>
						<label class="grid gap-1 text-xs font-semibold text-muted-foreground">Updated to<Input type="date" name="updatedTo" value={filters.updatedTo} class="h-8 font-normal" /></label>
					</div>
				</div>
				<div class="mt-4 flex justify-between gap-2 border-t border-border pt-3">
					<Button href={pathname + (view ? `?view=${view}` : '')} variant="ghost" size="sm">Clear all</Button>
					<Button type="submit" size="sm">Apply filters</Button>
				</div>
			</div>
		</details>

		<NativeSelect name="sort" value={filters.sort} aria-label="Sort" onchange={submit} class="w-auto min-w-44">
			{#each Object.entries(SORTS) as [value, label] (value)}<option {value}>{label}</option>{/each}
		</NativeSelect>

		{#if view}
			<div class="flex rounded-md border border-border p-0.5" role="group" aria-label="View">
				<a href={hrefWith({}, { view: 'list' })} aria-current={view === 'list' ? 'true' : undefined} class={cn('inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm', view === 'list' ? 'bg-hover font-medium' : 'text-muted-foreground hover:text-foreground')}>
					<List class="size-4" /><span class="hidden sm:inline">List</span>
				</a>
				<a href={hrefWith({}, { view: 'board' })} aria-current={view === 'board' ? 'true' : undefined} class={cn('inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm', view === 'board' ? 'bg-hover font-medium' : 'text-muted-foreground hover:text-foreground')}>
					<Columns3 class="size-4" /><span class="hidden sm:inline">Board</span>
				</a>
			</div>
		{/if}
		<noscript><Button type="submit" variant="secondary">Apply</Button></noscript>
	</div>

	{#if chips.length || filters.q}
		<div class="flex flex-wrap items-center gap-1.5">
			{#if filters.q}
				<a href={hrefWith({ q: '' })} class="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs hover:bg-hover">“{filters.q}” <X class="size-3" /><span class="sr-only">Remove search</span></a>
			{/if}
			{#each chips as chip (chip.label)}
				<a href={chip.href} class="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs hover:bg-hover">{chip.label} <X class="size-3" /><span class="sr-only">Remove filter</span></a>
			{/each}
			<a href={pathname + (view ? `?view=${view}` : '')} class="ml-1 text-xs text-muted-foreground hover:text-foreground hover:underline">Clear filters</a>
		</div>
	{/if}
</form>
