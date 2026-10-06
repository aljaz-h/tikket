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

	let { data } = $props();
	const filtered = $derived(activeFilterCount(data.filters) > 0 || !!data.filters.q);
</script>

<div class="grid gap-4">
	<TicketFilters filters={data.filters} view={data.view as "list" | "board"} labels={data.labels} assignable={data.assignable} />

	{#if data.view === 'board' && data.board}
		<TicketBoard projectKey={data.project.key} columns={data.board.columns} totals={data.board.totals} statuses={data.board.statuses} canManage={data.permissions.isStaff} />
	{:else if data.list}
		{#if data.list.rows.length}
			<div class="hidden items-center gap-3 px-4 text-xs text-muted-foreground sm:flex" aria-hidden="true">
				<span class="w-4"></span><span class="w-20">Ticket</span><span class="flex-1">Title</span>
				<span class="hidden w-24 md:block">Type</span><span class="hidden w-20 lg:block">Priority</span>
				<span class="w-14 text-right">Votes</span><span class="w-6"></span><span class="w-24 text-right">Updated</span>
			</div>
			<TicketList tickets={data.list.rows} />
			<Pagination
				page={data.list.page}
				pages={data.list.pages}
				total={data.list.total}
				label="tickets"
				href={(p) => `${page.url.pathname}?${filtersToParams({ ...data.filters, page: p }).toString()}`}
			/>
		{:else if filtered}
			<EmptyState icon={Inbox} title="No matching tickets" description="Try a different search or clear some filters.">
				<Button href={page.url.pathname} variant="secondary">Clear filters</Button>
			</EmptyState>
		{:else}
			<EmptyState icon={Inbox} title="No tickets yet" description="Bug reports, feature requests and ideas will show up here.">
				{#if data.permissions.canSubmit}<Button href="/new?project={data.project.key}"><Plus /> New ticket</Button>{/if}
			</EmptyState>
		{/if}
	{/if}
</div>
