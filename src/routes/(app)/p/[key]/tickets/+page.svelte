<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import Plus from '@lucide/svelte/icons/plus';
	import TicketFilters from '$lib/components/TicketFilters.svelte';
	import TicketList from '$lib/components/TicketList.svelte';
	import TicketBoard from '$lib/components/TicketBoard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { activeFilterCount, filtersToParams } from '$lib/shared/filters';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import NativeSelect from '$lib/components/ui/native-select.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import {
		PRIORITY_META,
		STATUS_META,
		TICKET_PRIORITIES,
		TICKET_STATUSES
	} from '$lib/shared/constants';
	import { ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const filtered = $derived(activeFilterCount(data.filters) > 0 || !!data.filters.q);

	// ── Bulk editing (staff only) ──
	const canBulk = $derived(data.permissions.isStaff && data.view === 'list');
	let selected = $state<number[]>([]);
	let change = $state('');
	let confirmOpen = $state(false);
	let confirmed = false;
	let pending = $state(false);
	let formEl: HTMLFormElement | undefined = $state();
	const visible = $derived(data.list?.rows.map((r) => r.number) ?? []);
	// Selection never outlives the page of results it was made on.
	$effect(() => {
		const keep = visible;
		selected = selected.filter((n) => keep.includes(n));
	});
	const allSelected = $derived(visible.length > 0 && selected.length === visible.length);
	const someSelected = $derived(selected.length > 0 && !allSelected);

	const changeLabel = $derived.by(() => {
		const [op, value] = change.split(':');
		if (op === 'status') return `set the status to “${STATUS_META[value as 'open']?.label}”`;
		if (op === 'priority') return `set the priority to “${PRIORITY_META[value as 'low']?.label}”`;
		if (op === 'assign')
			return value === 'none'
				? 'remove the assignee'
				: `assign them to ${data.assignable.find((u) => String(u.id) === value)?.displayName}`;
		const label = data.labels.find((l) => String(l.id) === value)?.name;
		if (op === 'addLabel') return `add the label “${label}”`;
		if (op === 'removeLabel') return `remove the label “${label}”`;
		return '';
	});
</script>

<div class="grid gap-4">
	<TicketFilters
		filters={data.filters}
		view={data.view as 'list' | 'board'}
		labels={data.labels}
		assignable={data.assignable}
	/>

	{#if data.view === 'board' && data.board}
		<TicketBoard
			projectKey={data.project.key}
			columns={data.board.columns}
			totals={data.board.totals}
			statuses={data.board.statuses}
			canManage={data.permissions.isStaff}
		/>
	{:else if data.list}
		{#if data.list.rows.length}
			<div
				class="hidden items-center gap-3 px-4 text-xs text-muted-foreground sm:flex"
				aria-hidden="true"
			>
				<span class="w-4"></span><span class="w-20">Ticket</span><span class="flex-1">Title</span>
				<span class="hidden w-24 md:block">Type</span><span class="hidden w-20 lg:block"
					>Priority</span
				>
				<span class="w-14 text-right">Votes</span><span class="w-6"></span><span
					class="w-24 text-right">Updated</span
				>
			</div>
			{#if canBulk}
				<form
					bind:this={formEl}
					method="POST"
					action="?/bulk"
					class="grid gap-2"
					use:enhance={({ cancel }) => {
						if (!confirmed) {
							cancel();
							if (!selected.length) toast.error('Select at least one ticket');
							else if (!change) toast.error('Choose what to change');
							else confirmOpen = true;
							return;
						}
						confirmed = false;
						pending = true;
						return async ({ result, update }) => {
							pending = false;
							confirmOpen = false;
							if (result.type === 'failure') {
								toast.error(
									Object.values((result.data?.errors ?? {}) as Record<string, string>)[0] ??
										'The bulk update failed.'
								);
								return;
							}
							if (result.type === 'success') {
								const r = result.data?.bulk as
									{ updated: number[]; skipped: { number: number; reason: string }[] } | undefined;
								if (r) {
									const n = r.updated.length;
									if (n) toast.success(`Updated ${n} ticket${n === 1 ? '' : 's'}`);
									if (r.skipped.length)
										toast.warning(
											`Skipped ${r.skipped.length} ticket${r.skipped.length === 1 ? '' : 's'}`,
											{
												description: r.skipped
													.slice(0, 5)
													.map((s) => `${ticketRef(data.project.key, s.number)}: ${s.reason}`)
													.join('\n')
											}
										);
								}
								selected = [];
								change = '';
							}
							await update({ reset: false });
						};
					}}
				>
					<div
						class="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 sm:px-4"
						role="toolbar"
						aria-label="Bulk actions"
					>
						<label class="flex items-center gap-2 text-sm">
							<Checkbox
								checked={allSelected}
								indeterminate={someSelected}
								onchange={(e) =>
									(selected = (e.currentTarget as HTMLInputElement).checked ? [...visible] : [])}
							/>
							<span class={selected.length ? 'font-medium' : 'text-muted-foreground'}
								>{selected.length ? `${selected.length} selected` : 'Select all'}</span
							>
						</label>
						<span class="flex-1"></span>
						<NativeSelect
							name="change"
							bind:value={change}
							aria-label="Bulk change"
							class="h-8 w-full text-xs sm:w-56"
						>
							<option value="">Change selected…</option>
							<optgroup label="Status">
								{#each TICKET_STATUSES.filter((s) => s !== 'duplicate') as s (s)}<option
										value="status:{s}">{STATUS_META[s].label}</option
									>{/each}
							</optgroup>
							<optgroup label="Priority">
								{#each TICKET_PRIORITIES as p (p)}<option value="priority:{p}"
										>{PRIORITY_META[p].label}</option
									>{/each}
							</optgroup>
							<optgroup label="Assignee">
								<option value="assign:none">Unassigned</option>
								{#each data.assignable as u (u.id)}<option value="assign:{u.id}"
										>{u.displayName}</option
									>{/each}
							</optgroup>
							{#if data.labels.length}
								<optgroup label="Add label">
									{#each data.labels as l (l.id)}<option value="addLabel:{l.id}">+ {l.name}</option
										>{/each}
								</optgroup>
								<optgroup label="Remove label">
									{#each data.labels as l (l.id)}<option value="removeLabel:{l.id}"
											>− {l.name}</option
										>{/each}
								</optgroup>
							{/if}
						</NativeSelect>
						<Button type="submit" size="sm" disabled={!selected.length || !change} loading={pending}
							>Apply</Button
						>
					</div>
					<TicketList tickets={data.list.rows} bind:selected />
				</form>
				<Dialog
					bind:open={confirmOpen}
					title="Update {selected.length} ticket{selected.length === 1 ? '' : 's'}?"
					description="This will {changeLabel} for the selected tickets. Tickets that already match are skipped. Each change is recorded in the ticket’s history."
					size="sm"
				>
					{#snippet footer()}
						<Button variant="ghost" onclick={() => (confirmOpen = false)}>Cancel</Button>
						<Button
							loading={pending}
							onclick={() => {
								confirmed = true;
								formEl?.requestSubmit();
							}}>Update tickets</Button
						>
					{/snippet}
				</Dialog>
			{:else}
				<TicketList tickets={data.list.rows} />
			{/if}
			<Pagination
				page={data.list.page}
				pages={data.list.pages}
				total={data.list.total}
				label="tickets"
				href={(p) =>
					`${page.url.pathname}?${filtersToParams({ ...data.filters, page: p }).toString()}`}
			/>
		{:else if filtered}
			<EmptyState
				icon={Inbox}
				title="No matching tickets"
				description="Try a different search or clear some filters."
			>
				<Button href={page.url.pathname} variant="secondary">Clear filters</Button>
			</EmptyState>
		{:else}
			<EmptyState
				icon={Inbox}
				title="No tickets yet"
				description="Bug reports, feature requests and ideas will show up here."
			>
				{#if data.permissions.canSubmit}<Button href="/new?project={data.project.key}"
						><Plus /> New ticket</Button
					>{/if}
			</EmptyState>
		{/if}
	{/if}
</div>
