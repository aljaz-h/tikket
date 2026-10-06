<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import Plus from '@lucide/svelte/icons/plus';
	import TicketFilters from '$lib/components/TicketFilters.svelte';
	import TicketTable, { type QuickActions } from '$lib/components/TicketTable.svelte';
	import TicketBoard from '$lib/components/TicketBoard.svelte';
	import ViewsPanel from '$lib/components/ViewsPanel.svelte';
	import ColumnPicker from '$lib/components/ColumnPicker.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { activeFilterCount, filtersToParams } from '$lib/shared/filters';
	import { page } from '$app/state';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import {
		PRIORITY_META,
		STATUS_META,
		TICKET_COLUMNS,
		TICKET_PRIORITIES,
		TICKET_STATUSES,
		type TicketColumn
	} from '$lib/shared/constants';
	import { projectPath, ticketRef } from '$lib/shared/format';

	let { data } = $props();
	const filtered = $derived(activeFilterCount(data.filters) > 0 || !!data.filters.q);
	const staff = $derived(data.permissions.isStaff && !data.permissions.archived);
	const base = $derived(projectPath(data.project.key, 'tickets'));
	const openReleases = $derived(
		data.releases.filter((r) => r.status === 'planned' || r.status === 'in_progress')
	);
	const openMilestones = $derived(data.milestones.filter((m) => m.status === 'open'));
	const availableColumns = $derived(
		TICKET_COLUMNS.filter(
			(c: TicketColumn) =>
				c !== 'project' && (data.permissions.isStaff || (c !== 'release' && c !== 'milestone'))
		)
	);
	const keepParams = $derived({
		...(data.view === 'board' ? { view: 'board' } : {}),
		...(page.url.searchParams.get('cols') ? { cols: page.url.searchParams.get('cols')! } : {}),
		...(data.savedId ? { saved: String(data.savedId) } : {})
	});

	// ── Changes: the same options for bulk edits and per-ticket quick actions ──
	const changeOptions = $derived({
		status: TICKET_STATUSES.filter((s) => s !== 'duplicate').map((s) => ({
			value: s,
			label: STATUS_META[s].label
		})),
		priority: TICKET_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label })),
		assign: [
			{ value: 'none', label: 'Unassigned' },
			...data.assignable.map((u) => ({ value: String(u.id), label: u.displayName }))
		],
		addLabel: data.labels.map((l) => ({ value: String(l.id), label: l.name })),
		removeLabel: data.labels.map((l) => ({ value: String(l.id), label: l.name })),
		release: [
			{ value: 'none', label: 'No release' },
			...openReleases.map((r) => ({ value: String(r.id), label: r.version }))
		],
		milestone: [
			{ value: 'none', label: 'No milestone' },
			...openMilestones.map((m) => ({ value: String(m.id), label: m.name }))
		]
	});
	const quick: QuickActions | null = $derived(staff ? changeOptions : null);
	const GROUPS: [keyof typeof changeOptions, string, string?][] = [
		['status', 'Status'],
		['priority', 'Priority'],
		['assign', 'Assignee'],
		['addLabel', 'Add label', '+ '],
		['removeLabel', 'Remove label', '− '],
		['release', 'Target release'],
		['milestone', 'Milestone']
	];
	const bulkItems = $derived(
		GROUPS.flatMap(([op, group, prefix]) =>
			changeOptions[op].map((o) => ({
				value: `${op}:${o.value}`,
				label: `${prefix ?? ''}${o.label}`,
				group
			}))
		)
	);

	function report(r: { updated: number[]; skipped: { number: number; reason: string }[] }) {
		const n = r.updated.length;
		if (n) toast.success(`Updated ${n} ticket${n === 1 ? '' : 's'}`);
		if (r.skipped.length)
			toast.warning(`Skipped ${r.skipped.length} ticket${r.skipped.length === 1 ? '' : 's'}`, {
				description: r.skipped
					.slice(0, 5)
					.map((s) => `${ticketRef(data.project.key, s.number)}: ${s.reason}`)
					.join('\n')
			});
	}

	/** Quick action on one ticket: the same server action (and checks) as bulk editing. */
	async function quickAction(number: number, change: string) {
		const body = new FormData();
		body.set('change', change);
		body.set('ticket', String(number));
		const res = await fetch(`${base}?/bulk`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true', accept: 'application/json' }
		});
		const result = deserialize(await res.text());
		if (result.type === 'success' && result.data?.bulk) {
			const r = result.data.bulk as {
				updated: number[];
				skipped: { number: number; reason: string }[];
			};
			if (r.updated.length) toast.success(`${ticketRef(data.project.key, number)} updated`);
			else report(r);
			await invalidateAll();
		} else if (result.type === 'failure') {
			toast.error(
				Object.values((result.data?.errors ?? {}) as Record<string, string>)[0] ??
					'That did not work'
			);
		} else toast.error('That did not work');
	}

	// ── Bulk editing (staff only) ──
	const canBulk = $derived(staff && data.view === 'list');
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
		untrack(() => {
			if (selected.some((n) => !keep.includes(n)))
				selected = selected.filter((n) => keep.includes(n));
		});
	});
	const allSelected = $derived(visible.length > 0 && selected.length === visible.length);
	const someSelected = $derived(selected.length > 0 && !allSelected);
	const changeLabel = $derived.by(() => {
		const item = bulkItems.find((i) => i.value === change);
		return item ? `${item.group.toLowerCase()}: ${item.label.replace(/^[+−] /, '')}` : '';
	});
</script>

<div class="grid gap-4 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-6">
	<ViewsPanel
		views={data.views}
		{base}
		query={data.listQuery}
		columns={data.columns}
		savedId={data.savedId}
		signedIn={!!data.user}
		isStaff={staff}
		keep={data.view === 'board' ? { view: 'board' } : {}}
	/>

	<div class="grid min-w-0 content-start gap-4">
		<div class="flex flex-wrap items-start gap-2">
			<div class="min-w-0 flex-1">
				<TicketFilters
					filters={data.filters}
					view={data.view as 'list' | 'board'}
					labels={data.labels}
					assignable={data.assignable}
					releases={data.permissions.isStaff ? data.releases : undefined}
					milestones={data.permissions.isStaff ? data.milestones : undefined}
					signedIn={!!data.user}
					extraParams={keepParams}
				/>
			</div>
			{#if data.view === 'list'}<ColumnPicker
					columns={data.columns}
					available={availableColumns}
				/>{/if}
		</div>

		{#if data.removedFilters.length}
			<FormMessage
				variant="info"
				message="Some filters referred to {data.removedFilters.join(
					', '
				)} that no longer exist and were ignored."
			/>
		{/if}

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
										| { updated: number[]; skipped: { number: number; reason: string }[] }
										| undefined;
									if (r) report(r);
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
							<Select
								name="change"
								bind:value={change}
								aria-label="Bulk change"
								placeholder="Change selected…"
								size="sm"
								searchable
								class="w-full sm:w-64"
								items={bulkItems}
							/>
							<Button
								type="submit"
								size="sm"
								disabled={!selected.length || !change}
								loading={pending}>Apply</Button
							>
						</div>
						<TicketTable
							rows={data.list.rows}
							columns={data.columns}
							listQuery={data.listQuery}
							bind:selected
							{quick}
							onquick={(n, c) => quickAction(n, c)}
						/>
					</form>
					<Dialog
						bind:open={confirmOpen}
						title="Update {selected.length} ticket{selected.length === 1 ? '' : 's'}?"
						description="This will set {changeLabel} for the selected tickets. Tickets that already match are skipped. Each change is recorded in the ticket’s history."
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
					<TicketTable rows={data.list.rows} columns={data.columns} listQuery={data.listQuery} />
				{/if}
				<Pagination
					page={data.list.page}
					pages={data.list.pages}
					total={data.list.total}
					label="tickets"
					href={(p) =>
						`${page.url.pathname}?${filtersToParams({ ...data.filters, page: p }, keepParams).toString()}`}
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
</div>
