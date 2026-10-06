<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import Pagination from '$lib/components/Pagination.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import { formatDateTime } from '$lib/shared/format';

	let { data } = $props();
</script>

<div class="grid gap-4">
	<form method="GET" class="relative max-w-md" role="search">
		<Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input type="search" name="q" value={data.q} placeholder="Filter by action or username" aria-label="Filter audit log" class="pl-8" />
	</form>
	<div class="overflow-x-auto rounded-xl border border-border bg-surface">
		<table class="w-full text-sm">
			<thead class="border-b border-border text-left text-xs text-muted-foreground">
				<tr><th class="px-4 py-2.5 font-medium">When</th><th class="px-4 py-2.5 font-medium">Action</th><th class="px-4 py-2.5 font-medium">Actor</th><th class="px-4 py-2.5 font-medium">Target</th><th class="hidden px-4 py-2.5 font-medium lg:table-cell">Details</th><th class="hidden px-4 py-2.5 font-medium md:table-cell">IP</th></tr>
			</thead>
			<tbody class="divide-y divide-border">
				{#each data.rows as log (log.id)}
					<tr class="align-top">
						<td class="px-4 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(log.createdAt)}</td>
						<td class="px-4 py-2 font-mono text-xs">{log.action}</td>
						<td class="px-4 py-2">{log.actorName ?? 'system'}{#if log.actorUsername}<span class="text-xs text-muted-foreground"> @{log.actorUsername}</span>{/if}</td>
						<td class="px-4 py-2 text-muted-foreground">{log.targetType ?? ''}{log.targetId ? ` #${log.targetId}` : ''}</td>
						<td class="hidden max-w-xs px-4 py-2 font-mono text-xs break-all text-muted-foreground lg:table-cell">{Object.keys(log.data).length ? JSON.stringify(log.data) : ''}</td>
						<td class="hidden px-4 py-2 font-mono text-xs text-muted-foreground md:table-cell">{log.ipAddress ?? ''}</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-4 py-8 text-center text-muted-foreground">No entries.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<Pagination page={data.page} pages={data.pages} total={data.total} label="events" href={(p) => `?q=${encodeURIComponent(data.q)}&page=${p}`} />
</div>
