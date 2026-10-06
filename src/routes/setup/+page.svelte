<script lang="ts">
	import { enhance } from '$app/forms';
	import AccountFields from '$lib/components/AccountFields.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';

	let { form } = $props();
	let pending = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<main id="main" class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
	<div class="mb-6 text-lg"><Logo /></div>
	<Card class="w-full max-w-md p-6">
		<h1 class="text-lg font-semibold tracking-tight">Set up Tikket</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Create the first administrator account. This page is disabled once setup is complete.
		</p>
		<form
			method="POST"
			class="mt-5 grid gap-4"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update({ reset: false });
					pending = false;
				};
			}}
		>
			<FormMessage message={errors.form} />
			<Field
				label="Workspace name"
				for="appName"
				optional
				hint="Shown in the sidebar and page titles."
			>
				<Input
					id="appName"
					name="appName"
					placeholder="Tikket"
					maxlength={60}
					value={values.appName ?? ''}
				/>
			</Field>
			<AccountFields {errors} {values} />
			<Button type="submit" class="mt-1 w-full" loading={pending}>Create administrator</Button>
		</form>
	</Card>
</main>
