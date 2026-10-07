<script lang="ts">
	import { enhance } from '$app/forms';
	import Archive from '@lucide/svelte/icons/archive';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import ConfirmDialog from '$lib/components/ui/confirm-dialog.svelte';

	let { data } = $props();
	const p = $derived(data.project);
	let archiveOpen = $state(false);
</script>

<Card class="border-destructive/30 p-5 sm:p-6">
	<h2 class="text-base font-semibold">Danger zone</h2>
	<div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<p class="text-sm text-muted-foreground">
			{#if data.permissions.archived}This project is archived. Unarchive it to accept new tickets
				again.{:else}Archiving makes the project read-only. All tickets, comments and history are
				preserved.{/if}
		</p>
		{#if data.permissions.archived}
			<form
				method="POST"
				action="?/unarchive"
				use:enhance={quickSubmit({ success: 'Project unarchived' })}
			>
				<Button type="submit" variant="secondary">Unarchive project</Button>
			</form>
		{:else}
			<Button variant="destructive-outline" onclick={() => (archiveOpen = true)}
				><Archive /> Archive project</Button
			>
		{/if}
	</div>
</Card>

<ConfirmDialog
	bind:open={archiveOpen}
	title="Archive {p.name}?"
	description="The project becomes read-only. You can unarchive it later."
	confirmLabel="Archive"
	destructive
	action="?/archive"
	successMessage="Project archived"
/>
