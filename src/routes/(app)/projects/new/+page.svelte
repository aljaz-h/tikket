<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProjectFields from '$lib/components/ProjectFields.svelte';
	import Checkbox from '$lib/components/ui/checkbox.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Select from '$lib/components/ui/select.svelte';

	let { data, form } = $props();
	let pending = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<div class="mx-auto grid max-w-3xl gap-6">
	<PageHeader
		title="New project"
		description="Projects keep tickets, members, the roadmap and changelog together."
	/>
	<Card class="p-5 sm:p-6">
		<form
			method="POST"
			enctype="multipart/form-data"
			class="grid gap-5"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update({ reset: false });
					pending = false;
				};
			}}
		>
			<FormMessage message={errors.form} />
			<ProjectFields {errors} {values} />
			{#if data.owners.length}
				<Field
					label="Owner"
					for="ownerId"
					error={errors.ownerId}
					hint="The owner manages the project, its members and settings."
				>
					<Select
						id="ownerId"
						name="ownerId"
						value={values.ownerId ?? String(data.user?.id)}
						searchable={data.owners.length > 8}
						items={data.owners.map((o) => ({
							value: String(o.id),
							label: `${o.displayName} (@${o.username})`
						}))}
					/>
				</Field>
			{/if}
			<fieldset class="grid gap-2 border-t border-border pt-5">
				<legend class="text-[0.8125rem] font-medium">
					Logo <span class="font-normal text-muted-foreground">(optional)</span>
				</legend>
				<p class="text-xs text-muted-foreground">
					PNG, JPEG or WebP up to 5 MB. You can also change it later in the project settings.
				</p>
				<input
					type="file"
					name="logo"
					accept="image/png,image/jpeg,image/webp"
					aria-label="Logo image"
					class="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-hover"
				/>
				<label class="flex items-center gap-2 text-sm">
					<Checkbox name="fetchIcon" />
					Otherwise use the website's icon (if a website is set)
				</label>
			</fieldset>
			<div class="flex justify-end gap-2 border-t border-border pt-5">
				<Button href="/projects" variant="ghost">Cancel</Button>
				<Button type="submit" loading={pending}>Create project</Button>
			</div>
		</form>
	</Card>
</div>
