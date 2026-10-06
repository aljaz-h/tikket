<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Dialog from '../ui/dialog.svelte';
	import Field from '../ui/field.svelte';
	import Input from '../ui/input.svelte';
	import Textarea from '../ui/textarea.svelte';
	import Button from '../ui/button.svelte';

	interface Props {
		open: boolean;
		milestone?: { name: string; description: string | null; targetDate: string | null } | null;
		action: string;
	}
	let { open = $bindable(), milestone = null, action }: Props = $props();
	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
</script>

<Dialog
	bind:open
	title={milestone ? `Edit “${milestone.name}”` : 'New milestone'}
	description="A goal that groups related tickets, such as “Improve mobile experience”."
>
	<form
		method="POST"
		{action}
		class="grid gap-4"
		use:enhance={() => {
			pending = true;
			return async ({ result, update }) => {
				pending = false;
				if (result.type === 'failure') {
					errors = (result.data?.errors ?? {}) as Record<string, string>;
					return;
				}
				errors = {};
				open = false;
				toast.success(milestone ? 'Milestone updated' : 'Milestone created');
				await update({ reset: false });
			};
		}}
	>
		<Field label="Name" for="ms-name" required error={errors.name}>
			<Input
				id="ms-name"
				name="name"
				value={milestone?.name ?? ''}
				maxlength={80}
				required
				placeholder="Improve mobile experience"
			/>
		</Field>
		<Field label="Description" for="ms-desc" optional error={errors.description}>
			<Textarea
				id="ms-desc"
				name="description"
				value={milestone?.description ?? ''}
				rows={3}
				maxlength={2000}
			/>
		</Field>
		<Field label="Target date" for="ms-target" optional error={errors.targetDate}>
			<Input
				id="ms-target"
				name="targetDate"
				type="date"
				value={milestone?.targetDate ?? ''}
				class="sm:w-48"
			/>
		</Field>
		{#if errors.form}<p class="text-sm text-destructive" role="alert">{errors.form}</p>{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" loading={pending}
				>{milestone ? 'Save changes' : 'Create milestone'}</Button
			>
		</div>
	</form>
</Dialog>
