<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import FileJson from '@lucide/svelte/icons/file-braces';
	import Sheet from '@lucide/svelte/icons/sheet';
	import Package from '@lucide/svelte/icons/package';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { formatBytes } from '$lib/shared/format';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import { cn } from '$lib/utils';

	let { data } = $props();
	const href = (format: 'json' | 'csv' | 'bundle', scope = 'standard') =>
		`/p/${data.project.key.toLowerCase()}/settings/export/download?format=${format}&scope=${scope}`;
	let scope = $state<'standard' | 'staff'>('standard');
	let preparing = $state(false);
	function startBundle() {
		// The download is streamed; show that something is happening until the browser takes over.
		preparing = true;
		setTimeout(() => (preparing = false), 6000);
	}
</script>

<div class="grid gap-6 lg:grid-cols-2">
	<Card class="grid content-start gap-4 p-5 sm:p-6">
		<div class="flex items-start gap-3">
			<FileJson class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
			<div>
				<h2 class="text-base font-semibold">Project export (JSON)</h2>
				<p class="text-sm text-muted-foreground">
					Everything about the project in one versioned file (<code class="text-xs"
						>tikket-project</code
					>, version 1): settings, members, labels, releases, milestones and every ticket with its
					comments, history, relationships, votes and template answers. Uploaded images are listed
					by name only.
				</p>
			</div>
		</div>
		<fieldset class="grid gap-2">
			<legend class="mb-1.5 text-[0.8125rem] font-medium">Contents</legend>
			{#each [{ value: 'standard', label: 'Standard export', text: 'Public discussion only – no internal notes.' }, { value: 'staff', label: 'Staff export', text: 'Also includes internal notes and voter names. Share only with project staff.' }] as option (option.value)}
				<label
					class={cn(
						'flex cursor-pointer gap-3 rounded-lg border border-border p-3 transition-colors hover:border-border-strong has-[:checked]:border-primary-border has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring'
					)}
				>
					<input
						type="radio"
						name="scope"
						value={option.value}
						bind:group={scope}
						class="sr-only"
					/>
					{#if option.value === 'staff'}<ShieldAlert
							class="mt-0.5 size-4 shrink-0 text-muted-foreground"
						/>{:else}<FileJson class="mt-0.5 size-4 shrink-0 text-muted-foreground" />{/if}
					<span>
						<span class="block text-sm font-medium">{option.label}</span>
						<span class="block text-xs text-muted-foreground">{option.text}</span>
					</span>
				</label>
			{/each}
		</fieldset>
		<div class="flex justify-end">
			<Button href={href('json', scope)} download><Download /> Download JSON</Button>
		</div>
	</Card>

	<Card class="grid content-start gap-4 p-5 sm:p-6">
		<div class="flex items-start gap-3">
			<Package class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
			<div>
				<h2 class="text-base font-semibold">Project bundle (.zip)</h2>
				<p class="text-sm text-muted-foreground">
					The JSON export (with the contents chosen on the left) plus the uploaded images of its
					tickets and comments, with checksums. Use it to move a project to another Tikket – the
					import restores the images too.
				</p>
			</div>
		</div>
		<p class="text-sm">
			{data.estimate.count} image{data.estimate.count === 1 ? '' : 's'}, about
			<strong>{formatBytes(data.estimate.bytes)}</strong>
		</p>
		{#if data.estimate.bytes > data.warnBytes}
			<p
				class="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
			>
				<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" /> This is a large download. It may
				take a while; importing it elsewhere needs a BODY_SIZE_LIMIT at least this big.
			</p>
		{/if}
		<div class="flex flex-wrap items-center justify-end gap-3">
			{#if preparing}<span class="text-xs text-muted-foreground" role="status"
					>Preparing the bundle – the download starts shortly…</span
				>{/if}
			<Button href={href('bundle', scope)} download onclick={startBundle} loading={preparing}
				><Download /> Download bundle</Button
			>
		</div>
	</Card>

	<Card class="grid content-start gap-4 p-5 sm:p-6">
		<div class="flex items-start gap-3">
			<Sheet class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
			<div>
				<h2 class="text-base font-semibold">Tickets (CSV)</h2>
				<p class="text-sm text-muted-foreground">
					One row per ticket for spreadsheets: ID, title, type, status, priority, reporter,
					assignee, labels, votes, release, milestone, dates and link. Cells that a spreadsheet
					would treat as formulas are escaped.
				</p>
			</div>
		</div>
		<div class="flex justify-end">
			<Button variant="outline" href={href('csv')} download><Download /> Download CSV</Button>
		</div>
	</Card>
	<p class="text-xs text-muted-foreground lg:col-span-2">
		Exports never contain passwords, sessions, email addresses, API tokens or integration secrets.
		Every export is recorded in the audit log. The formats are documented in docs/data-export.md.
	</p>
</div>
