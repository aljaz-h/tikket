<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { formatBytes, formatDateTime } from '$lib/shared/format';

	let { data } = $props();
	const commands = [
		{
			title: '1. Create a database snapshot (safe while running)',
			code: 'docker compose exec tikket node scripts/backup.js /data/backups 14'
		},
		{
			title: '2. Archive the snapshot and the attachments to the host',
			code: 'docker run --rm -v tikket_tikket-data:/data -v "$PWD":/backup alpine \\\n  tar czf /backup/tikket-$(date +%F).tar.gz -C /data backups uploads'
		},
		{
			title: '3. Verify the archive (read-only)',
			code: 'docker compose exec tikket node scripts/backup-verify.js /data/backups/<file>.db --uploads /data/uploads'
		},
		{
			title: '4. Dry-run restore (migrates a temporary copy, never the live data)',
			code: 'docker compose run --rm --no-deps -v "$PWD":/backup tikket node scripts/restore-verify.js /backup/tikket-YYYY-MM-DD.tar.gz'
		}
	];
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success('Copied');
		} catch {
			toast.error('Copy failed – select the text manually');
		}
	}
</script>

<div class="grid gap-6">
	<div
		role="note"
		class="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" />
		<p>
			Keep a copy of <code class="font-mono">ENCRYPTION_KEY</code> outside the server (e.g. in a
			password manager). Encrypted integration secrets in a backup – SMTP password, Discord and
			webhook URLs, signing secrets, GitHub secrets –
			<strong>cannot be restored without it</strong>. The key is currently {data.encryption
				? 'configured'
				: 'not set'} on this server.
		</p>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		<Card class="grid content-start gap-2 p-5">
			<h2 class="text-sm font-semibold">Last backup</h2>
			{#if data.last}
				<p class="flex items-center gap-2 text-sm">
					<CircleCheck class="size-4 text-success" />
					<TimeAgo date={new Date(data.last.createdAt)} />
					<span class="text-muted-foreground">({formatDateTime(data.last.createdAt)})</span>
				</p>
				<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
					<dt class="text-muted-foreground">File</dt>
					<dd class="font-mono [overflow-wrap:anywhere]">{data.last.file}</dd>
					<dt class="text-muted-foreground">Size</dt>
					<dd>{formatBytes(data.last.bytes)}</dd>
					{#if data.last.migrations}<dt class="text-muted-foreground">Schema</dt>
						<dd>{data.last.migrations} migrations</dd>{/if}
				</dl>
			{:else}
				<p class="text-sm text-muted-foreground">
					No backup has been recorded on this server yet. Run the backup script below – it records
					each successful run here. Backups made by stopping the container and archiving the volume
					are not recorded.
				</p>
			{/if}
		</Card>
		<Card class="grid content-start gap-2 p-5">
			<h2 class="text-sm font-semibold">Storage</h2>
			<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
				<dt class="text-muted-foreground">Data directory</dt>
				<dd class="text-right">{formatBytes(data.sizes.data)}</dd>
				<dt class="text-muted-foreground">Database</dt>
				<dd class="text-right">{formatBytes(data.sizes.database)}</dd>
				<dt class="text-muted-foreground">Uploads</dt>
				<dd class="text-right">{formatBytes(data.sizes.uploads)}</dd>
				<dt class="text-muted-foreground">Encryption key</dt>
				<dd class="text-right">{data.encryption ? 'Configured' : 'Not set'}</dd>
			</dl>
		</Card>
	</div>

	{#if data.files.length}
		<Card class="grid gap-2 p-5">
			<h2 class="text-sm font-semibold">Snapshots on the data volume</h2>
			<ul class="divide-y divide-border text-sm">
				{#each data.files as f (f.name)}
					<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-1.5">
						<span class="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{f.name}</span>
						<span class="text-xs text-muted-foreground"
							>{formatBytes(f.bytes)} · <TimeAgo date={f.modifiedAt} /></span
						>
					</li>
				{/each}
			</ul>
			<p class="text-xs text-muted-foreground">
				Snapshots on the same volume protect against mistakes, not against losing the server – copy
				archives somewhere else.
			</p>
		</Card>
	{/if}

	<Card class="grid gap-4 p-5 sm:p-6">
		<div>
			<h2 class="text-sm font-semibold">Back up, verify and test a restore</h2>
			<p class="text-sm text-muted-foreground">
				Tikket doesn't upload backups anywhere. Run these on the server (Docker Compose; the volume
				is named <code class="font-mono">&lt;project&gt;_tikket-data</code>). Details in
				<code class="font-mono">docs/backup-verification.md</code>.
			</p>
		</div>
		{#each commands as c (c.title)}
			<div class="grid gap-1.5">
				<p class="text-xs font-medium">{c.title}</p>
				<div class="flex items-start gap-2">
					<pre
						class="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs">{c.code}</pre>
					<Button
						variant="ghost"
						size="xs"
						onclick={() => copy(c.code)}
						aria-label="Copy: {c.title}"><Copy /></Button
					>
				</div>
			</div>
		{/each}
	</Card>
</div>
