<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';

	let { form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let pending = $state(false);
</script>

<Card class="p-6 sm:p-8">
	<h1 class="mb-1 text-xl font-semibold tracking-tight">Forgot your password?</h1>
	<p class="mb-6 text-sm text-muted-foreground">
		Enter your username or email address. If an account matches, we email a link to choose a new
		password.
	</p>
	{#if form?.sent}
		<FormMessage
			variant="success"
			message="If an account matches, a reset link is on its way. It is valid for 24 hours. Check your spam folder if nothing arrives within a few minutes."
		/>
	{:else}
		<form
			method="POST"
			class="grid gap-4"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					pending = false;
					await update();
				};
			}}
		>
			<FormMessage message={errors.form} />
			<Field label="Username or email" for="identifier" error={errors.identifier}>
				<Input
					id="identifier"
					name="identifier"
					autocomplete="username"
					autocapitalize="none"
					spellcheck="false"
					required
				/>
			</Field>
			<Button type="submit" class="w-full" loading={pending}>Email me a reset link</Button>
		</form>
	{/if}
</Card>
<p class="mt-4 text-center text-sm text-muted-foreground">
	<a href="/login" class="font-medium text-link hover:underline">Back to sign in</a>
</p>
