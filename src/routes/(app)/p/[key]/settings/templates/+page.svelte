<script lang="ts">
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import TypeBadge from '$lib/components/TypeBadge.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Badge from '$lib/components/ui/badge.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';
	import { TICKET_TYPES, TYPE_META } from '$lib/shared/constants';
	import { projectPath } from '$lib/shared/format';

	let { data } = $props();
	const base = $derived(projectPath(data.project.key, 'settings/templates'));
	let deleting = $state<{ id: number; name: string } | null>(null);
	let deleteOpen = $state(false);
</script>

<div class="grid gap-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold">Ticket templates</h2>
			<p class="max-w-2xl text-sm text-muted-foreground">
				Add your own questions to the ticket form – per ticket type. The title and description
				always stay; templates only add questions. The default enabled template of a type is used in
				the web form and the feedback widget.
			</p>
		</div>
		<Button href="{base}/new"><Plus /> New template</Button>
	</div>

	{#if data.templates.length}
		{#each TICKET_TYPES as type (type)}
			{@const list = data.templates.filter((t) => t.type === type)}
			{#if list.length}
				<section class="grid gap-2" aria-labelledby="tpl-{type}">
					<h3 id="tpl-{type}" class="text-sm font-medium text-muted-foreground">
						<TypeBadge {type} short={false} />
					</h3>
					<ul
						class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface"
					>
						{#each list as t (t.id)}
							<li class="flex flex-wrap items-center gap-3 px-4 py-3">
								<div class="min-w-0 flex-1 basis-40">
									<p class="flex flex-wrap items-center gap-2 font-medium">
										{t.name}
										{#if t.isDefault}<Badge variant="solid">Default</Badge>{/if}
										{#if !t.enabled}<Badge variant="muted">Disabled</Badge>{/if}
									</p>
									<p class="text-xs text-muted-foreground">
										{t.fields.length} question{t.fields.length === 1 ? '' : 's'} · version {t.version}
										· updated <TimeAgo date={t.updatedAt} />
									</p>
								</div>
								<div class="flex flex-wrap items-center gap-1">
									{#if !t.isDefault}
										<form
											method="POST"
											action="?/makeDefault"
											use:enhance={quickSubmit({
												success: `${t.name} is now the default ${TYPE_META[t.type].short.toLowerCase()} template`
											})}
										>
											<input type="hidden" name="templateId" value={t.id} /><Button
												type="submit"
												size="xs"
												variant="ghost">Make default</Button
											>
										</form>
									{/if}
									<form
										method="POST"
										action="?/toggle"
										use:enhance={quickSubmit({
											success: t.enabled ? 'Template disabled' : 'Template enabled'
										})}
									>
										<input type="hidden" name="templateId" value={t.id} /><Button
											type="submit"
											size="xs"
											variant="ghost">{t.enabled ? 'Disable' : 'Enable'}</Button
										>
									</form>
									<Button
										href="{base}/{t.id}"
										size="icon-xs"
										variant="subtle"
										aria-label="Edit {t.name}"><Pencil /></Button
									>
									<Button
										size="icon-xs"
										variant="subtle"
										aria-label="Delete {t.name}"
										onclick={() => {
											deleting = t;
											deleteOpen = true;
										}}><Trash2 /></Button
									>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{:else}
		<Card class="p-0">
			<EmptyState
				icon={ListChecks}
				title="No templates yet"
				description="Without templates, reporters see the standard form: title, description and the built-in optional details."
			>
				<Button href="{base}/new" variant="secondary"><Plus /> Create a template</Button>
			</EmptyState>
		</Card>
	{/if}
</div>

{#if deleting}
	<ConfirmDialog
		bind:open={deleteOpen}
		title="Delete “{deleting.name}”?"
		description="New tickets will no longer use it. Tickets created with it keep their answers and the questions as they were asked."
		confirmLabel="Delete"
		destructive
		action="?/delete"
		fields={{ templateId: deleting.id }}
		successMessage="Template deleted"
	/>
{/if}
