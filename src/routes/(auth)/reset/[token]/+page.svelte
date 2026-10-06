<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';

	let { data, form } = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
</script>

<Card class="p-6">
	{#if !data.valid}
		<h1 class="text-lg font-semibold tracking-tight">Link expired</h1>
		<p class="mt-2 text-sm text-muted-foreground">This password reset link is invalid or has expired. Ask an administrator for a new one.</p>
	{:else}
		<h1 class="text-lg font-semibold tracking-tight">Choose a new password</h1>
		<p class="mt-1 text-sm text-muted-foreground">For {data.displayName}. All existing sessions will be signed out.</p>
		<form method="POST" class="mt-5 grid gap-4" use:enhance>
			<FormMessage message={errors.form} />
			<Field label="New password" for="newPassword" error={errors.newPassword} hint="At least 10 characters.">
				<Input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required minlength={10} />
			</Field>
			<Field label="Confirm password" for="confirmPassword" error={errors.confirmPassword}>
				<Input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required minlength={10} />
			</Field>
			<Button type="submit" class="w-full">Set password</Button>
		</form>
	{/if}
</Card>
