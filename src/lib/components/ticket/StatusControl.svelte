<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import Select from '../ui/select.svelte';
	import Textarea from '../ui/textarea.svelte';
	import Input from '../ui/input.svelte';
	import Button from '../ui/button.svelte';
	import {
		STATUS_META,
		STATUSES_WITH_NOTE,
		TICKET_STATUSES,
		type TicketStatus
	} from '$lib/shared/constants';
	import { quickSubmit } from './enhance';

	interface Props {
		status: TicketStatus;
		projectKey: string;
	}
	let { status, projectKey }: Props = $props();
	let selected = $derived<TicketStatus>(status);
	let formEl: HTMLFormElement | undefined = $state();
	let js = $state(false);
	onMount(() => {
		js = true;
	});

	const needsDetails = $derived(selected !== status && STATUSES_WITH_NOTE.includes(selected));

	function onChange() {
		// Simple transitions apply immediately; those with an explanation reveal the extra fields.
		if (selected !== status && !STATUSES_WITH_NOTE.includes(selected)) formEl?.requestSubmit();
	}
</script>

<form
	bind:this={formEl}
	method="POST"
	action="?/status"
	class="grid gap-2"
	use:enhance={quickSubmit({ success: 'Status updated' })}
>
	<Select
		name="status"
		bind:value={selected as string}
		onchange={onChange}
		aria-label="Status"
		items={TICKET_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))}
	/>
	{#if needsDetails || !js}
		<div class="grid gap-2 rounded-lg border border-border bg-muted/50 p-2.5">
			{#if selected === 'duplicate' || !js}
				<label class="grid gap-1 text-xs font-medium">
					Duplicate of {#if !js}(only for “Duplicate”){/if}
					<Input
						name="duplicateOf"
						placeholder="{projectKey}-12"
						required={selected === 'duplicate' && js}
						class="h-8 font-mono"
					/>
					<span class="font-normal text-muted-foreground"
						>Merges into the original: its voters and followers are added there (each person counted
						once). This ticket keeps its own history.</span
					>
				</label>
			{/if}
			<label class="grid gap-1 text-xs font-medium">
				{selected === 'completed' ? 'Resolution note' : 'Explanation'}
				<span class="font-normal text-muted-foreground">(optional, visible to everyone)</span>
				<Textarea
					name="note"
					rows={2}
					maxlength={2000}
					class="min-h-14"
					placeholder={selected === 'completed'
						? 'Fixed in version 1.4'
						: 'Why this decision was made'}
				/>
			</label>
			<div class="flex justify-end gap-2">
				{#if js}<Button size="xs" variant="ghost" onclick={() => (selected = status)}>Cancel</Button
					>{/if}
				<Button size="xs" type="submit">Update status</Button>
			</div>
		</div>
	{/if}
</form>
