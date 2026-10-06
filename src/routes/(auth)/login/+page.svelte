<script lang="ts">
	import { enhance } from '$app/forms';
	import FormMessage from '$lib/components/FormMessage.svelte';
	import Button from '$lib/components/ui/button.svelte';
	import Card from '$lib/components/ui/card.svelte';
	import Field from '$lib/components/ui/field.svelte';
	import Input from '$lib/components/ui/input.svelte';

	let { data, form } = $props();
	let pending = $state(false);
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
</script>

<Card class="p-6">
	<h1 class="text-lg font-semibold tracking-tight">Sign in</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		Welcome back. Sign in to report and follow tickets.
	</p>
	<form
		method="POST"
		class="mt-5 grid gap-4"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update();
				pending = false;
			};
		}}
	>
		<FormMessage message={errors.form} />
		<input type="hidden" name="next" value={data.next} />
		<Field label="Username or email" for="identifier" error={errors.identifier}>
			<Input
				id="identifier"
				name="identifier"
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				required
				value={form?.values?.identifier ?? ''}
			/>
		</Field>
		<Field label="Password" for="password" error={errors.password}>
			<Input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
		</Field>
		<Button type="submit" class="w-full" loading={pending}>Sign in</Button>
	</form>
</Card>
{#if data.app.registrationEnabled}
	<p class="mt-4 text-center text-sm text-muted-foreground">
		New here? <a href="/register" class="font-medium text-link hover:underline">Create an account</a
		>
	</p>
{:else}
	<p class="mt-4 text-center text-sm text-muted-foreground">
		Need an account? Ask an administrator for an invitation.
	</p>
{/if}
