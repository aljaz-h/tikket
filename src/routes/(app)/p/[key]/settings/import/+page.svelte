<script lang="ts">
	import { enhance } from '$app/forms';
	import Upload from '@lucide/svelte/icons/upload';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import TimeAgo from '$lib/components/TimeAgo.svelte';
	import IntegrationStatus from '$lib/components/integrations/IntegrationStatus.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import { projectPath } from '$lib/shared/format';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let busy = $state(false);
	const stateOf = (s: string) =>
		s === 'completed'
			? ({ state: 'ok', label: 'Imported' } as const)
			: s === 'failed'
				? ({ state: 'error', label: 'Failed' } as const)
				: s === 'running'
					? ({ state: 'warn', label: 'Running' } as const)
					: ({ state: 'off', label: 'Waiting for review' } as const);
</script>

<Card class="grid gap-4 p-5 sm:p-6">
	<div>
		<h2 class="text-base font-semibold">Import tickets</h2>
		<p class="text-sm text-muted-foreground">
			Bring tickets into this project from a Tikket export – JSON, or a project bundle (.zip) that
			also carries the images – or from a CSV file of a spreadsheet or another tracker. You review
			everything before anything is created, and the import runs all-or-nothing.
		</p>
	</div>
	<ul class="grid gap-1 text-xs text-muted-foreground">
		<li>
			• Up to {data.limits.tickets} tickets; {data.limits.megabytes} MB per JSON/CSV file, {data
				.limits.bundleMegabytes} MB per bundle (and within the server's upload limit).
		</li>
		<li>
			• Accounts, passwords, tokens and integration secrets are never imported. People can be
			matched to existing project members if you choose to.
		</li>
		<li>
			• Images are imported from bundles (checked against their checksums); votes never are.
			Original ticket IDs are kept as references.
		</li>
	</ul>
	<form
		method="POST"
		enctype="multipart/form-data"
		class="grid gap-4"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				busy = false;
				await update();
			};
		}}
	>
		<FormMessage message={errors.form} />
		<Field
			label="File"
			for="import-file"
			error={errors.file}
			hint="Tikket JSON (.json), project bundle (.zip) or CSV (.csv)"
		>
			<input
				id="import-file"
				name="file"
				type="file"
				accept=".json,.zip,.csv,application/json,application/zip,text/csv"
				required
				class="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-hover"
			/>
		</Field>
		<div class="flex justify-end">
			<Button type="submit" loading={busy}><Upload /> Upload and review</Button>
		</div>
	</form>
</Card>

{#if data.imports.length}
	<Card class="grid gap-3 p-5 sm:p-6">
		<h2 class="text-base font-semibold">Recent imports</h2>
		<ul class="divide-y divide-border rounded-lg border border-border">
			{#each data.imports as imp (imp.id)}
				{@const st = stateOf(imp.status)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
					<IntegrationStatus state={st.state} label={st.label} />
					<a
						href={projectPath(data.project.key, `settings/import/${imp.id}`)}
						class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] hover:underline"
						>{imp.fileName}</a
					>
					<span class="text-xs text-muted-foreground">
						{#if imp.result && typeof imp.result.tickets === 'number'}{imp.result.tickets} tickets ·
						{/if}{imp.createdBy ?? 'Deleted user'} · <TimeAgo date={imp.createdAt} />
					</span>
				</li>
			{/each}
		</ul>
	</Card>
{:else}
	<p
		class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
	>
		No imports yet. Uploaded files are reviewed here before anything is created.
	</p>
{/if}
