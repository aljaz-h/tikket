<script lang="ts">
	import { enhance } from '$app/forms';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Input from '$lib/components/ui/input.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { LABEL_COLORS } from '$lib/shared/constants';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
</script>

<Card class="p-5 sm:p-6">
	<h2 class="text-base font-semibold">Labels</h2>
	<p class="mb-5 text-sm text-muted-foreground">
		Staff can add labels to tickets to categorise them (for example “iOS”, “Sync”, “Design”).
	</p>
	<form
		method="POST"
		action="?/createLabel"
		class="flex flex-col gap-2 sm:flex-row"
		use:enhance={quickSubmit({ success: 'Label created', reset: true })}
	>
		<Input
			name="name"
			placeholder="New label name"
			aria-label="Label name"
			required
			maxlength={40}
			class="flex-1"
		/>
		<Select
			name="color"
			value="slate"
			aria-label="Colour"
			class="sm:w-32"
			items={LABEL_COLORS.map((c) => ({ value: c, label: c }))}
		/>
		<Button type="submit" variant="secondary">Add label</Button>
	</form>
	{#if errors.name}<p class="mt-2 text-xs text-destructive" role="alert">
			{errors.name}
		</p>{/if}
	{#if data.labels.length}
		<ul class="mt-4 divide-y divide-border rounded-lg border border-border">
			{#each data.labels as label (label.id)}
				<li class="flex flex-wrap items-center gap-2 px-3 py-2">
					<form
						method="POST"
						action="?/updateLabel"
						class="flex flex-1 flex-wrap items-center gap-2"
						use:enhance={quickSubmit({ success: 'Label updated' })}
					>
						<input type="hidden" name="labelId" value={label.id} />
						<span class="swatch-{label.color} swatch-solid size-3 rounded-full"></span>
						<Input
							name="name"
							value={label.name}
							aria-label="Label name"
							class="h-8 min-w-32 flex-1"
							maxlength={40}
						/>
						<Select
							name="color"
							value={label.color}
							aria-label="Colour"
							class="w-28"
							size="sm"
							items={LABEL_COLORS.map((c) => ({ value: c, label: c }))}
						/>
						<span class="text-xs text-muted-foreground">{label.usage} tickets</span>
						<Button type="submit" size="xs" variant="outline">Save</Button>
					</form>
					<form
						method="POST"
						action="?/deleteLabel"
						use:enhance={quickSubmit({ success: 'Label deleted' })}
					>
						<input type="hidden" name="labelId" value={label.id} />
						<Button
							type="submit"
							size="icon-xs"
							variant="subtle"
							aria-label="Delete label {label.name}"><Trash2 /></Button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</Card>
