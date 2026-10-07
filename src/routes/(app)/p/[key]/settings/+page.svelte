<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ProjectFields from '$lib/components/ProjectFields.svelte';
	import ProjectLogo from '$lib/components/ProjectLogo.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import { quickSubmit } from '$lib/components/ticket/enhance';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Switch from '$lib/components/ui/switch.svelte';
	import Select from '$lib/components/ui/select.svelte';
	import { EDIT_POLICIES, EDIT_POLICY_META } from '$lib/shared/constants';

	let { data, form } = $props();

	// Old links such as /settings#members now have their own pages.
	onMount(() => {
		const legacy: Record<string, string> = {
			'#members': 'members',
			'#labels': 'labels',
			'#danger-zone': 'danger'
		};
		const target = legacy[location.hash];
		if (target) goto(`${location.pathname.replace(/\/$/, '')}/${target}`, { replaceState: true });
	});
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const p = $derived(data.project);
	let voting = $state(true);
	let attachments = $state(true);
	let comments = $state(true);
	$effect.pre(() => {
		voting = p.votingEnabled;
		attachments = p.attachmentsEnabled;
		comments = p.commentsEnabled;
	});
</script>

<div class="grid gap-6">
	{#if page.url.searchParams.get('logo') === 'failed'}
		<FormMessage
			variant="info"
			message="The project was created, but its logo could not be set. Try again below."
		/>
	{/if}
	<Card class="p-5 sm:p-6">
		<h2 class="text-base font-semibold">General</h2>
		<p class="mb-5 text-sm text-muted-foreground">
			Basic information, visibility and contribution rules.
		</p>
		<form
			method="POST"
			action="?/update"
			class="grid gap-5"
			use:enhance={quickSubmit({ success: 'Project settings saved' })}
		>
			<FormMessage message={errors.form} />
			<ProjectFields {errors} values={form?.values ?? p} keyLocked />
			<div class="grid gap-4 border-t border-border pt-5">
				<h3 class="text-sm font-semibold">Member permissions</h3>
				<Field
					label="Who can submit tickets?"
					for="submissionPolicy"
					hint="Applies to public projects. Private projects only accept members."
				>
					<Select
						id="submissionPolicy"
						name="submissionPolicy"
						value={p.submissionPolicy}
						items={[
							{ value: 'any_user', label: 'Any signed-in user' },
							{ value: 'members', label: 'Project members only' }
						]}
					/>
				</Field>
				<Field label="Editing own submissions" for="editPolicy">
					<Select
						id="editPolicy"
						name="editPolicy"
						value={p.editPolicy}
						items={EDIT_POLICIES.map((e) => ({ value: e, label: EDIT_POLICY_META[e] }))}
					/>
				</Field>
				{#each [{ name: 'votingEnabled', label: 'Voting', hint: 'Let users upvote tickets they care about.' }, { name: 'attachmentsEnabled', label: 'Screenshots & attachments', hint: 'Allow images on tickets and comments.' }, { name: 'commentsEnabled', label: 'Comments', hint: 'When off, only project staff can comment.' }] as opt (opt.name)}
					<label class="flex items-start gap-3">
						{#if opt.name === 'votingEnabled'}<Switch
								name={opt.name}
								bind:checked={voting}
								class="mt-0.5"
							/>{:else if opt.name === 'attachmentsEnabled'}<Switch
								name={opt.name}
								bind:checked={attachments}
								class="mt-0.5"
							/>{:else}<Switch name={opt.name} bind:checked={comments} class="mt-0.5" />{/if}
						<span
							><span class="block text-sm font-medium">{opt.label}</span><span
								class="block text-xs text-muted-foreground">{opt.hint}</span
							></span
						>
					</label>
				{/each}
			</div>
			<div class="flex justify-end border-t border-border pt-5">
				<Button type="submit" disabled={data.permissions.archived}>Save changes</Button>
			</div>
		</form>
	</Card>

	<ProjectLogo project={p} canEdit={!data.permissions.archived} />
</div>
