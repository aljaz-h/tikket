<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import Dialog from '../ui/dialog.svelte';
	import Field from '../ui/field.svelte';
	import Input from '../ui/input.svelte';
	import Select from '../ui/select.svelte';
	import Button from '../ui/button.svelte';
	import RichTextEditor from '../RichTextEditor.svelte';
	import { RELEASE_STATUS_META, type ReleaseStatus } from '$lib/shared/constants';

	interface Props {
		open: boolean;
		release?: {
			version: string;
			targetDate: string | null;
			status: ReleaseStatus;
			summaryHtml: string;
		} | null;
		action: string;
	}
	let { open = $bindable(), release = null, action }: Props = $props();
	let errors = $state<Record<string, string>>({});
	let pending = $state(false);
	const released = $derived(release?.status === 'released');
	const statuses = $derived(
		(released ? ['released'] : ['planned', 'in_progress', 'cancelled']) as ReleaseStatus[]
	);
</script>

<Dialog
	bind:open
	title={release ? `Edit ${release.version}` : 'New release'}
	description={released
		? 'This release is published. Changes to its notes are recorded in its history.'
		: 'Plan a version, then add tickets to it.'}
	size="lg"
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
				if (result.type === 'success' || result.type === 'redirect') {
					errors = {};
					open = false;
					toast.success(release ? 'Release updated' : 'Release created');
				}
				await update({ reset: false });
			};
		}}
	>
		<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
			<Field label="Version or name" for="rel-version" required error={errors.version}>
				<Input
					id="rel-version"
					name="version"
					value={release?.version ?? ''}
					maxlength={60}
					placeholder="v0.15.0"
					required
				/>
			</Field>
			<Field label="Target date" for="rel-target" optional error={errors.targetDate}>
				<Input id="rel-target" name="targetDate" type="date" value={release?.targetDate ?? ''} />
			</Field>
		</div>
		<Field label="Status" for="rel-status" error={errors.status}>
			<Select
				id="rel-status"
				name="status"
				value={release?.status ?? 'planned'}
				disabled={released}
				items={statuses.map((s) => ({ value: s, label: RELEASE_STATUS_META[s].label }))}
			/>
			{#if released}<input type="hidden" name="status" value="released" />{/if}
		</Field>
		<div class="grid gap-1.5">
			<span class="text-[0.8125rem] font-medium"
				>Release notes <span class="font-normal text-muted-foreground"
					>(optional, public once published)</span
				></span
			>
			<RichTextEditor
				id="rel-notes"
				name="summary"
				label="Release notes"
				value={release?.summaryHtml ?? ''}
				compact
				minHeight="6rem"
			/>
		</div>
		{#if errors.form}<p class="text-sm text-destructive" role="alert">{errors.form}</p>{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" loading={pending}>{release ? 'Save changes' : 'Create release'}</Button>
		</div>
	</form>
</Dialog>
