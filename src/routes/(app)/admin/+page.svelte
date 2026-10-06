<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Card from '$lib/components/ui/card.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { formatBytes } from '$lib/shared/text';

	let { data } = $props();
	const stats = $derived([
		{ label: 'Users', value: data.stats.users, href: '/admin/users' },
		{ label: 'Projects', value: data.stats.projects, href: '/admin/projects' },
		{ label: 'Tickets', value: data.stats.tickets },
		{ label: 'Comments', value: data.stats.comments },
		{ label: 'Images', value: data.stats.attachments },
		{ label: 'Storage', value: formatBytes(data.stats.storage) }
	]);
</script>

<div class="grid gap-6">
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
		{#each stats as s (s.label)}
			<Card class="p-4">
				<p class="text-xs text-muted-foreground">{s.label}</p>
				<p class="mt-1 text-xl font-semibold tabular-nums">{s.value}</p>
			</Card>
		{/each}
	</div>
	<section class="grid gap-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-semibold">Recent security events</h2>
			<a
				href="/admin/audit"
				class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>Audit log <ArrowRight class="size-3.5" /></a
			>
		</div>
		<Card class="divide-y divide-border">
			{#each data.recentAudit as log (log.id)}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
					<span class="font-mono text-xs">{log.action}</span>
					<span class="text-muted-foreground">by {log.actorName ?? 'system'}</span>
					<span class="ml-auto text-xs text-muted-foreground"><TimeAgo date={log.createdAt} /></span
					>
				</div>
			{:else}
				<p class="px-4 py-6 text-center text-sm text-muted-foreground">No events yet.</p>
			{/each}
		</Card>
	</section>
</div>
