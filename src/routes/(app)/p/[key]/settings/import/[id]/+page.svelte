<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import { PRIORITY_META, TYPE_META } from '$lib/shared/constants';
	import { formatBytes, projectPath, ticketPath } from '$lib/shared/format';

	let { data, form } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/import'));
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let busy = $state<string | null>(null);
	let formEl: HTMLFormElement | undefined = $state();

	let mapUsers = $state(false);
	let keepNumbers = $state(false);
	let importComments = $state(true);
	let createMissing = $state(true);
	let mapping = $state<Record<string, string>>({});
	$effect.pre(() => {
		mapUsers = data.options.mapUsers;
		keepNumbers = data.options.keepNumbers;
		importComments = data.options.importComments;
		createMissing = data.options.createMissing;
		mapping = Object.fromEntries(
			Object.entries(data.options.mapping ?? {}).map(([k, v]) => [k, String(v)])
		);
	});

	const columnItems = $derived([
		{ value: '-1', label: 'Not imported' },
		...(data.csv?.headers ?? []).map((h, i) => ({
			value: String(i),
			label: h || `Column ${i + 1}`
		}))
	]);
	const result = $derived(
		(form?.imported ?? data.imp.result) as Record<string, number | null> | null
	);

	/** Options and mapping apply immediately so the review below always matches them. */
	function refresh() {
		formEl?.requestSubmit(
			formEl.querySelector<HTMLButtonElement>('button[formaction="?/options"]') ?? undefined
		);
	}
	const submit = () => {
		return async ({
			action,
			result: r,
			update
		}: {
			action: URL;
			result: { type: string; data?: Record<string, unknown>; error?: { message?: string } };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			busy = null;
			if (r.type === 'failure') {
				const e = (r.data?.errors ?? {}) as Record<string, string>;
				toast.error(Object.values(e)[0] ?? 'That did not work.');
			} else if (r.type === 'error') toast.error(r.error?.message ?? 'Something went wrong.');
			else if (action.search.includes('confirm')) toast.success('Import finished');
			await update({ reset: false });
		};
	};
</script>

<nav
	aria-label="Breadcrumb"
	class="-mt-2 mb-4 flex items-center gap-1 text-sm text-muted-foreground"
>
	<a href={base} class="inline-flex items-center gap-1 hover:text-foreground"
		><ChevronLeft class="size-4" />Import</a
	>
	<span aria-hidden="true">/</span>
	<span class="font-medium [overflow-wrap:anywhere] text-foreground" aria-current="page"
		>{data.imp.fileName}</span
	>
</nav>

{#if data.imp.status === 'completed' && result}
	<Card class="grid gap-4 p-5 sm:p-6">
		<p class="flex items-center gap-2 text-base font-semibold">
			<CircleCheck class="size-5 text-success" /> Import finished
		</p>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-xs text-muted-foreground">Tickets</dt>
				<dd>{result.tickets}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Comments</dt>
				<dd>{result.comments}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Labels created</dt>
				<dd>{result.labelsCreated}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Releases / milestones created</dt>
				<dd>{result.releasesCreated} / {result.milestonesCreated}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Original numbers kept</dt>
				<dd>{result.keptNumbers}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Links between tickets</dt>
				<dd>{result.relationships}</dd>
			</div>
			{#if result.attachments}
				<div>
					<dt class="text-xs text-muted-foreground">Images</dt>
					<dd>{result.attachments}</dd>
				</div>
			{/if}
			{#if result.firstNumber}
				<div class="col-span-2">
					<dt class="text-xs text-muted-foreground">Ticket numbers</dt>
					<dd>
						{data.project.key}-{result.firstNumber}{#if result.lastNumber !== result.firstNumber}
							… {data.project.key}-{result.lastNumber}{/if}
					</dd>
				</div>
			{/if}
		</dl>
		<div class="flex flex-wrap gap-2">
			<Button href={projectPath(data.project.key, 'tickets')}>Open tickets</Button>
			<Button href={base} variant="outline">Import another file</Button>
		</div>
		{#if data.imp.completedAt}<p class="text-xs text-muted-foreground">
				Finished <TimeAgo date={data.imp.completedAt} />
			</p>{/if}
	</Card>
{:else if data.imp.status === 'failed'}
	<Card class="grid gap-3 p-5 sm:p-6">
		<FormMessage message={`Nothing was imported: ${data.imp.error ?? 'the import failed.'}`} />
		<Button href={base} variant="outline" class="justify-self-start">Upload again</Button>
	</Card>
{:else if data.imp.status === 'running'}
	<Card class="p-5 text-sm sm:p-6">This import is running. Reload in a moment.</Card>
{:else if data.review}
	{@const r = data.review}
	<form
		bind:this={formEl}
		method="POST"
		action="?/confirm"
		class="grid gap-6"
		use:enhance={({ action }) => {
			busy = action.search.includes('confirm') ? 'confirm' : 'options';
			return submit();
		}}
	>
		<FormMessage message={errors.form} />
		{#if data.csv}
			<Card class="grid gap-4 p-5 sm:p-6">
				<div>
					<h2 class="text-base font-semibold">Map columns</h2>
					<p class="text-sm text-muted-foreground">
						Choose which column holds each field. Only the title is required. Values that don't
						match a type, status or priority fall back to the defaults.
					</p>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each data.csv.fields as f (f.field)}
						<label class="grid gap-1 text-xs font-medium">
							{f.label}
							<Select
								name="map_{f.field}"
								size="sm"
								bind:value={mapping[f.field]}
								items={columnItems}
								onchange={refresh}
							/>
						</label>
					{/each}
				</div>
				{#if data.csv.sample.length}
					<div class="overflow-x-auto rounded-lg border border-border">
						<table class="w-full min-w-[32rem] text-left text-xs">
							<caption class="sr-only">First rows of the file</caption>
							<thead class="bg-surface-2 text-muted-foreground">
								<tr>
									{#each data.csv.headers as h, i (i)}<th
											class="px-3 py-2 font-medium whitespace-nowrap">{h || `Column ${i + 1}`}</th
										>{/each}
								</tr>
							</thead>
							<tbody>
								{#each data.csv.sample as row, i (i)}
									<tr class="border-t border-border align-top">
										{#each data.csv.headers as _, j (j)}
											<td class="max-w-[16rem] truncate px-3 py-1.5">{row[j] ?? ''}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card>
		{/if}

		<Card class="grid gap-4 p-5 sm:p-6">
			<h2 class="text-base font-semibold">Options</h2>
			<div class="grid gap-4 sm:grid-cols-2">
				{#each [{ name: 'mapUsers', label: 'Match people to project members', hint: 'Reporters, assignees and comment authors with the same username or email address as a member of this project are linked to that member. Off: you are recorded, with the original name kept.', get: () => mapUsers, set: (v: boolean) => (mapUsers = v) }, { name: 'keepNumbers', label: 'Keep original ticket numbers', hint: 'Used when the number is free in this project; other tickets get new numbers. The original ID is always kept as a reference.', get: () => keepNumbers, set: (v: boolean) => (keepNumbers = v) }, { name: 'importComments', label: 'Import comments', hint: 'Comments (and internal notes from staff exports) from Tikket JSON files.', get: () => importComments, set: (v: boolean) => (importComments = v) }, { name: 'createMissing', label: 'Create missing labels, releases and milestones', hint: 'Off: references to ones that don’t exist in this project are dropped. New releases are never published automatically.', get: () => createMissing, set: (v: boolean) => (createMissing = v) }] as o (o.name)}
					<label class="flex items-start gap-3">
						<Switch
							name={o.name}
							checked={o.get()}
							onchange={(e) => {
								o.set(e.currentTarget.checked);
								refresh();
							}}
							class="mt-0.5"
						/>
						<span>
							<span class="block text-sm font-medium">{o.label}</span>
							<span class="block text-xs text-muted-foreground">{o.hint}</span>
						</span>
					</label>
				{/each}
			</div>
			<noscript>
				<Button type="submit" variant="outline" size="sm" formaction="?/options"
					>Apply options</Button
				>
			</noscript>
			<button type="submit" formaction="?/options" class="hidden" tabindex="-1" aria-hidden="true"
			></button>
		</Card>

		<Card class="grid gap-4 p-5 sm:p-6">
			<h2 class="text-base font-semibold">Review</h2>
			<dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				<div>
					<dt class="text-xs text-muted-foreground">Records in file</dt>
					<dd>{r.total}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Tickets to create</dt>
					<dd>{r.valid}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Skipped</dt>
					<dd>{r.skipped.length}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Comments</dt>
					<dd>{r.comments}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Numbers kept / new</dt>
					<dd>{r.keptNumbers} / {r.renumbered}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">New labels</dt>
					<dd class="[overflow-wrap:anywhere]">{r.newLabels.join(', ') || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">New releases</dt>
					<dd class="[overflow-wrap:anywhere]">{r.newReleases.join(', ') || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">New milestones</dt>
					<dd class="[overflow-wrap:anywhere]">{r.newMilestones.join(', ') || '—'}</dd>
				</div>
			</dl>
			{#if r.mappingWarnings.length}
				<ul
					class="grid gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs"
					aria-label="Column mapping"
				>
					{#each r.mappingWarnings as w (w)}
						<li class="flex items-start gap-2">
							<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />{w}
						</li>
					{/each}
				</ul>
			{/if}
			{#if r.attachments}
				<div class="grid gap-1 rounded-lg border border-border px-3 py-2.5 text-xs">
					<p class="font-medium">
						{r.attachments.count} image{r.attachments.count === 1 ? '' : 's'} will be imported ({formatBytes(
							r.attachments.bytes
						)})
					</p>
					{#if r.attachments.problems.length}
						<p class="text-warning">
							{r.attachments.problems.length} can't be imported and will be left out:
						</p>
						<ul class="grid gap-0.5 text-muted-foreground">
							{#each r.attachments.problems.slice(0, 20) as pr, i (i)}
								<li class="[overflow-wrap:anywhere]">{pr.name} – {pr.reason}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
			{#if r.skipped.length}
				<div
					class="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
				>
					<p class="flex items-center gap-2 font-medium">
						<CircleAlert class="size-4" />{r.skipped.length} record{r.skipped.length === 1
							? ''
							: 's'}
						will be skipped
					</p>
					<ul class="text-xs">
						{#each r.skipped.slice(0, 20) as s (s.row)}
							<li>{s.row ? `Row ${s.row}: ` : ''}{s.reason}</li>
						{/each}
						{#if r.skipped.length > 20}<li>… and {r.skipped.length - 20} more</li>{/if}
					</ul>
				</div>
			{/if}
			{#if r.warnings.length}
				<ul
					class="grid gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs"
				>
					{#each r.warnings as w (w)}
						<li class="flex items-start gap-2">
							<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" />{w}
						</li>
					{/each}
					{#if r.unmatchedUsers.length}
						<li class="pl-5.5 [overflow-wrap:anywhere] text-muted-foreground">
							Not matched: {r.unmatchedUsers.join(', ')}
						</li>
					{/if}
				</ul>
			{/if}
			{#if r.duplicates.length}
				<details class="rounded-lg border border-border px-3 py-2.5 text-xs">
					<summary class="cursor-pointer font-medium">
						{r.duplicates.length} possible duplicate{r.duplicates.length === 1 ? '' : 's'} (imported anyway)
					</summary>
					<ul class="mt-2 grid gap-1">
						{#each r.duplicates as d (d.row)}
							<li class="[overflow-wrap:anywhere]">
								Row {d.row} “{d.title}” –
								{#if d.existing}same title as
									<a
										href={ticketPath(data.project.key, d.existing)}
										class="text-link hover:underline">{data.project.key}-{d.existing}</a
									>{:else}same title as row {d.sameAsRow}{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if r.rowIssues.length}
				<details class="rounded-lg border border-border px-3 py-2.5 text-xs">
					<summary class="cursor-pointer font-medium">
						{r.rowIssues.length} row issue{r.rowIssues.length === 1 ? '' : 's'} (defaults used)
					</summary>
					<ul class="mt-2 grid gap-1 text-muted-foreground">
						{#each r.rowIssues.slice(0, 50) as ri, i (i)}
							<li class="[overflow-wrap:anywhere]">Row {ri.row}: {ri.message}</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if r.preview.length}
				<div class="overflow-x-auto rounded-lg border border-border">
					<table class="w-full min-w-[36rem] text-left text-xs">
						<caption class="sr-only">Preview of the first tickets</caption>
						<thead class="bg-surface-2 text-muted-foreground">
							<tr>
								<th class="px-3 py-2 font-medium">Original</th>
								<th class="px-3 py-2 font-medium">Title</th>
								<th class="px-3 py-2 font-medium">Type</th>
								<th class="px-3 py-2 font-medium">Status</th>
								<th class="px-3 py-2 font-medium">Priority</th>
								<th class="px-3 py-2 font-medium">Labels</th>
							</tr>
						</thead>
						<tbody>
							{#each r.preview as p (p.row)}
								<tr class="border-t border-border align-top">
									<td class="px-3 py-1.5 font-mono whitespace-nowrap">{p.ref ?? `#${p.row}`}</td>
									<td class="px-3 py-1.5 [overflow-wrap:anywhere]">{p.title}</td>
									<td class="px-3 py-1.5">{TYPE_META[p.type].label}</td>
									<td class="px-3 py-1.5"><StatusBadge status={p.status} /></td>
									<td class="px-3 py-1.5">{PRIORITY_META[p.priority].label}</td>
									<td class="px-3 py-1.5 [overflow-wrap:anywhere]">{p.labels.join(', ')}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if r.valid > r.preview.length}<p class="text-xs text-muted-foreground">
						… and {r.valid - r.preview.length} more.
					</p>{/if}
			{/if}
		</Card>

		<div class="flex flex-wrap items-center justify-between gap-3">
			<Button href={base} variant="ghost">Cancel</Button>
			<Button type="submit" loading={busy === 'confirm'} disabled={!r.valid || busy !== null}
				>Import {r.valid} ticket{r.valid === 1 ? '' : 's'}</Button
			>
		</div>
	</form>
{/if}
