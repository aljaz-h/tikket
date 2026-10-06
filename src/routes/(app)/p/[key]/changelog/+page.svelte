<script lang="ts">
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Rocket from '@lucide/svelte/icons/rocket';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import RichTextEditor from '$lib/components/RichTextEditor.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Dialog from '$lib/components/ui/dialog.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import { formatDate, ticketPath, ticketRef } from '$lib/shared/format';
	import type { TicketType } from '$lib/shared/constants';

	let { data, form } = $props();
	type Entry = (typeof data.entries)[number];
	let editorOpen = $state(false);
	let editing = $state<Entry | null>(null);
	let deleting = $state<Entry | null>(null);
	let deleteOpen = $state(false);
	let selected = $state<number[]>([]);
	let published = $state(true);
	let filter = $state('');
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const today = new Date().toISOString().slice(0, 10);

	function open(entry: Entry | null) {
		editing = entry;
		selected = entry ? entry.tickets.map((t) => t.id) : [];
		published = entry ? entry.published : true;
		filter = '';
		editorOpen = true;
	}
	const visibleTickets = $derived(
		data.completed.filter((t) => !filter || t.title.toLowerCase().includes(filter.toLowerCase()) || String(t.number) === filter.replace(/\D/g, ''))
	);
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted-foreground">Release notes and the completed tickets that shipped with them.</p>
		{#if data.canManage}<Button onclick={() => open(null)}><Plus /> New release</Button>{/if}
	</div>

	{#if data.entries.length}
		<ol class="relative grid gap-6 border-l border-border pl-6">
			{#each data.entries as entry (entry.id)}
				<li class="relative">
					<span class="absolute top-1.5 -left-[1.95rem] flex size-4 items-center justify-center rounded-full border border-border bg-background">
						<span class="size-1.5 rounded-full bg-primary"></span>
					</span>
					<Card class="p-5">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight">
									{entry.version}
									{#if !entry.published}<Badge variant="muted">Draft</Badge>{/if}
								</h2>
								<p class="text-sm text-muted-foreground">{formatDate(entry.releaseDate)}</p>
							</div>
							{#if data.canManage}
								<div class="flex gap-1">
									<Button variant="subtle" size="icon-sm" aria-label="Edit {entry.version}" onclick={() => open(entry)}><Pencil /></Button>
									<Button variant="subtle" size="icon-sm" aria-label="Delete {entry.version}" onclick={() => { deleting = entry; deleteOpen = true; }}><Trash2 /></Button>
								</div>
							{/if}
						</div>
						{#if entry.summaryHtml}<RichText html={entry.summaryHtml} class="mt-3 text-sm" />{/if}
						{#if entry.tickets.length}
							<ul class="mt-4 grid gap-1.5 border-t border-border pt-4">
								{#each entry.tickets as t (t.id)}
									<li class="flex items-center gap-2 text-sm">
										<TypeBadge type={t.type as TicketType} iconOnly />
										<a href={ticketPath(data.project.key, t.number)} class="min-w-0 truncate hover:underline">
											<span class="font-mono text-xs text-muted-foreground">{ticketRef(data.project.key, t.number)}</span>
											{t.title}
										</a>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>
				</li>
			{/each}
		</ol>
	{:else}
		<EmptyState icon={Rocket} title="No releases yet" description={data.canManage ? 'Publish a release to tell users what changed. Completed tickets are only listed once you include them.' : 'Release notes will appear here.'}>
			{#if data.canManage}<Button onclick={() => open(null)}><Plus /> New release</Button>{/if}
		</EmptyState>
	{/if}
</div>

{#if data.canManage}
	<Dialog bind:open={editorOpen} title={editing ? `Edit ${editing.version}` : 'New release'} size="lg">
		<form method="POST" action="?/save" class="grid gap-4" use:enhance={quickSubmit({ success: 'Release saved', onSuccess: () => (editorOpen = false) })}>
			{#if editing}<input type="hidden" name="entryId" value={editing.id} />{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<Field label="Version or release name" for="version" required error={errors.version}>
					<Input id="version" name="version" required maxlength={60} placeholder="v1.4.0" value={editing?.version ?? ''} />
				</Field>
				<Field label="Release date" for="releaseDate" required error={errors.releaseDate}>
					<Input id="releaseDate" name="releaseDate" type="date" required value={editing?.releaseDate ?? today} />
				</Field>
			</div>
			<Field label="Summary" for="summary" optional>
				<RichTextEditor id="summary" name="summary" label="Summary" value={editing?.summaryHtml ?? ''} compact minHeight="5rem" placeholder="Highlights of this release…" />
			</Field>
			<fieldset class="grid gap-2">
				<legend class="mb-1 text-[0.8125rem] font-medium">Completed tickets in this release <span class="font-normal text-muted-foreground">({selected.length} selected)</span></legend>
				<Input bind:value={filter} placeholder="Filter completed tickets…" aria-label="Filter completed tickets" class="h-8" />
				<div class="grid max-h-56 gap-0.5 overflow-y-auto rounded-md border border-border p-1">
					{#each visibleTickets as t (t.id)}
						<label class="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-hover">
							<input type="checkbox" name="ticketId" value={t.id} bind:group={selected} class="size-4 accent-[var(--primary)]" />
							<span class="font-mono text-xs text-muted-foreground">{ticketRef(data.project.key, t.number)}</span>
							<span class="min-w-0 flex-1 truncate">{t.title}</span>
						</label>
					{:else}
						<p class="px-2 py-4 text-center text-xs text-muted-foreground">No completed tickets yet.</p>
					{/each}
				</div>
				{#each selected.filter((id) => !visibleTickets.some((t) => t.id === id)) as id (id)}<input type="hidden" name="ticketId" value={id} />{/each}
			</fieldset>
			<label class="flex items-center gap-3 text-sm">
				<Switch name="published" bind:checked={published} />
				Published <span class="text-xs text-muted-foreground">— drafts are only visible to project owners</span>
			</label>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" onclick={() => (editorOpen = false)}>Cancel</Button>
				<Button type="submit">Save release</Button>
			</div>
		</form>
	</Dialog>
	{#if deleting}
		<ConfirmDialog bind:open={deleteOpen} title="Delete {deleting.version}?" description="The release note is removed. Tickets are not affected." confirmLabel="Delete" destructive action="?/delete" fields={{ entryId: deleting.id }} successMessage="Release deleted" />
	{/if}
{/if}
