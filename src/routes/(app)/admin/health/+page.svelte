<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatBytes, formatDateTime, formatDuration } from '$lib/shared/format';

	let { data } = $props();
	const h = $derived(data.health);
	const yes = (v: boolean) => (v ? 'Yes' : 'No');
</script>

{#snippet check(ok: boolean, label: string, value: string)}
	<div class="flex items-start justify-between gap-3 py-1.5">
		<dt class="flex items-center gap-1.5 text-muted-foreground">
			{#if ok}<CircleCheck class="size-3.5 shrink-0 text-success" aria-label="OK" />{:else}<CircleX
					class="size-3.5 shrink-0 text-destructive"
					aria-label="Problem"
				/>{/if}
			{label}
		</dt>
		<dd class="text-right [overflow-wrap:anywhere]">{value}</dd>
	</div>
{/snippet}
{#snippet row(label: string, value: string)}
	<div class="flex items-start justify-between gap-3 py-1.5">
		<dt class="text-muted-foreground">{label}</dt>
		<dd class="text-right [overflow-wrap:anywhere]">{value}</dd>
	</div>
{/snippet}

<div class="grid gap-6">
	{#if h.warnings.length}
		<ul
			class="grid gap-1.5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
			aria-label="Warnings"
		>
			{#each h.warnings as w (w.message)}
				<li class="flex items-start gap-2">
					<TriangleAlert
						class="mt-0.5 size-4 shrink-0 {w.level === 'error'
							? 'text-destructive'
							: 'text-warning'}"
					/>{w.message}
				</li>
			{/each}
		</ul>
	{:else}
		<p
			class="flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm"
			role="status"
		>
			<CircleCheck class="size-4 text-success" /> Everything looks healthy.
		</p>
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		<Card class="p-5">
			<h2 class="mb-2 text-sm font-semibold">Application</h2>
			<dl class="divide-y divide-border text-sm">
				{@render row('Tikket version', h.app.version)}
				{@render row('Uptime', formatDuration(h.app.uptimeSeconds))}
				{@render row('Environment', h.app.environment)}
				{@render row('Server time', formatDateTime(h.app.now))}
				{@render row('Public URL', h.app.publicUrl ?? 'Not set')}
			</dl>
		</Card>
		<Card class="p-5">
			<h2 class="mb-2 text-sm font-semibold">Database</h2>
			<dl class="divide-y divide-border text-sm">
				{@render check(h.db.connected, 'Connected', yes(h.db.connected))}
				{@render row('SQLite size', formatBytes(h.db.bytes))}
				{@render check(
					h.db.migrations >= h.db.expectedMigrations,
					'Migrations',
					`${h.db.migrations} of ${h.db.expectedMigrations}${h.db.latestMigration ? ` (${h.db.latestMigration})` : ''}`
				)}
				{@render check(h.db.wal, 'WAL mode', yes(h.db.wal))}
				{@render check(h.db.foreignKeys, 'Foreign keys', yes(h.db.foreignKeys))}
			</dl>
		</Card>
		<Card class="p-5">
			<h2 class="mb-2 text-sm font-semibold">Storage</h2>
			<dl class="divide-y divide-border text-sm">
				{@render check(
					h.storage.dataWritable,
					'Data directory writable',
					yes(h.storage.dataWritable)
				)}
				{@render check(
					h.storage.uploadsWritable,
					'Upload directory writable',
					yes(h.storage.uploadsWritable)
				)}
				{@render row(
					'Used',
					`${formatBytes(h.storage.dataBytes)} (uploads ${formatBytes(h.storage.uploadBytes)})${h.storage.partial ? ' – partial count' : ''}`
				)}
				{#if h.storage.disk}
					{@render row('Free on volume', formatBytes(h.storage.disk.free))}
				{/if}
				<div class="flex items-start justify-between gap-3 py-1.5">
					<dt class="text-muted-foreground">Last backup</dt>
					<dd class="text-right">
						{#if h.backup}<TimeAgo date={new Date(h.backup.createdAt)} />{:else}None recorded{/if}
						· <a href="/admin/backups" class="text-link hover:underline">Backups</a>
					</dd>
				</div>
			</dl>
		</Card>
		<Card class="p-5">
			<h2 class="mb-2 text-sm font-semibold">Delivery queue</h2>
			<dl class="divide-y divide-border text-sm">
				{@render row('Waiting', String(h.queue.pending))}
				{@render check(h.queue.retrying === 0, 'Retrying', String(h.queue.retrying))}
				{@render check(h.queue.failed === 0, 'Failed', String(h.queue.failed))}
			</dl>
			<a href="/admin/queue" class="mt-2 inline-block text-xs text-link hover:underline"
				>Open the delivery queue</a
			>
		</Card>
		<Card class="p-5 md:col-span-2">
			<h2 class="mb-2 text-sm font-semibold">Integrations</h2>
			<dl class="grid gap-x-8 text-sm sm:grid-cols-2">
				{@render row(
					'Email (SMTP)',
					h.integrations.smtpConfigured
						? h.integrations.emailEnabled
							? 'Configured'
							: 'Configured, sending off'
						: 'Not configured'
				)}
				{@render row('Encryption key', h.encryption ? 'Configured' : 'Not set')}
				{@render row('GitHub connections', String(h.integrations.github))}
				{@render row('Discord channels', String(h.integrations.discord))}
				{@render row('Webhooks', String(h.integrations.webhooks))}
			</dl>
		</Card>
	</div>
	<p class="text-xs text-muted-foreground">
		Checked when this page loads. Tikket collects no telemetry. A deeper database check is available
		with <code class="font-mono">npm run db:check</code>.
	</p>
</div>
