<script lang="ts">
	import { enhance } from '$app/forms';
	import AccountFields from '$lib/components/AccountFields.svelte';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';

	let { form } = $props();
	let pending = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	const values = $derived((form?.values ?? {}) as Record<string, string>);
</script>

<Card class="p-6">
	<h1 class="text-lg font-semibold tracking-tight">Create your account</h1>
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
		<AccountFields {errors} {values} />
		<Button type="submit" class="w-full" loading={pending}>Create account</Button>
	</form>
</Card>
<p class="mt-4 text-center text-sm text-muted-foreground">
	Already have an account? <a href="/login" class="font-medium text-primary hover:underline"
		>Sign in</a
	>
</p>
