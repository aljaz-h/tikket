<script lang="ts">
	import TabNav from '$lib/components/ui/tab-nav.svelte';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Plus from '@lucide/svelte/icons/plus';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import TicketFilters from '$lib/components/TicketFilters.svelte';
	import TicketList from '$lib/components/TicketList.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import { filtersToParams } from '$lib/shared/filters';

	let { data } = $props();
	const tabs = [
		{ id: 'created', label: 'Created by me' },
		{ id: 'following', label: 'Following' },
		{ id: 'assigned', label: 'Assigned to me' },
		{ id: 'completed', label: 'Resolved' }
	];
</script>

<div class="grid gap-6">
	<PageHeader
		title="My tickets"
		description="Track the progress of everything you reported or follow."
	>
		{#snippet actions()}<Button href="/new"><Plus /> New ticket</Button>{/snippet}
	</PageHeader>
	<TabNav
		label="My tickets"
		tabs={tabs.map((t) => ({ href: `?tab=${t.id}`, label: t.label, active: data.tab === t.id }))}
	/>
	<TicketFilters
		filters={data.filters}
		showReporter={data.tab !== 'created'}
		showAssignee={data.tab !== 'assigned'}
		extraParams={{ tab: data.tab }}
	/>
	{#if data.result.rows.length}
		<TicketList tickets={data.result.rows} showProject />
		<Pagination
			page={data.result.page}
			pages={data.result.pages}
			total={data.result.total}
			label="tickets"
			href={(p) =>
				`${page.url.pathname}?${filtersToParams({ ...data.filters, page: p }, { tab: data.tab }).toString()}`}
		/>
	{:else}
		<EmptyState
			icon={Inbox}
			title="Nothing here"
			description={data.tab === 'created'
				? 'Tickets you report will appear here with their current status.'
				: 'No tickets match.'}
		>
			{#if data.tab === 'created'}<Button href="/new" variant="secondary"
					><Plus /> Report something</Button
				>{/if}
		</EmptyState>
	{/if}
</div>
